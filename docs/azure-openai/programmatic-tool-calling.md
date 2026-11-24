# Programmatic tool calling with the Azure OpenAI Responses API

Programmatic tool calling lets a model use code to orchestrate tools during a Responses API request. Instead of requiring a separate model turn for each tool invocation, the model can generate a program that calls tools and processes their results. The program can perform operations such as branching or iteration.

This article explains when programmatic tool calling is useful and how it differs from function calling, parallel tool calling, and tool search.

## Availability considerations

Before implementing programmatic tool calling, confirm that your Azure OpenAI model deployment and SDK version support the feature. Don't assume that support for the Responses API also establishes support for programmatic tool calling.

For endpoint and authentication setup, see [Use the Azure OpenAI Responses API](../how-to/responses).

## Programmatic tool calling and function calling

With standard function calling, your application typically participates in each tool-calling step:

**Model -> tool call -> application executes tool -> model -> next tool call -> application executes tool -> model**

With programmatic tool calling, the model can generate code that orchestrates multiple tool operations:

**Model -> generated program -> tool operations -> program result -> model**

This approach can reduce the number of model turns needed for workflows involving several tools.

These flows illustrate the conceptual difference in orchestration. They don't specify which operations your application or the service executes.

## Example: Compare inventory with demand

This Python example exposes two application-defined functions that return sample inventory and demand data. The model uses programmatic tool calling to compare the results. Your application executes the functions and returns their results so that the runtime can resume the generated program.

The code blocks form one script. Combine them in the order shown.

### Azure OpenAI client

Use an Azure OpenAI deployment that supports programmatic tool calling and an OpenAI SDK version that includes `output_schema`, `allowed_callers`, and caller information. Install the `openai` and `azure-identity` packages in your Python environment:

```console
pip install --upgrade openai azure-identity
```

Configure Microsoft Entra ID authentication as described in [Use the Azure OpenAI Responses API](../how-to/responses). Your identity needs permission to call your Azure OpenAI deployment.

Replace `YOUR-RESOURCE-NAME` with your resource name. The `model` value later in the example is your Azure deployment name, not a model catalog identifier.

```python
import json

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

# Use the Azure OpenAI v1 endpoint and Microsoft Entra ID authentication.
endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/"
credential = DefaultAzureCredential()
token_provider = get_bearer_token_provider(
    credential, "https://cognitiveservices.azure.com/.default"
)
openai = OpenAI(base_url=endpoint, api_key=token_provider)
```

### Application-defined functions

The functions return fixed sample data: 42 available units and 31 requested units for the specified SKU. Replace their implementations with your inventory and demand data sources in your application.

```python
def get_inventory(sku):
    return {"sku": sku, "available_units": 42}


def get_demand(sku):
    return {"sku": sku, "requested_units": 31}


implementations = {
    "get_inventory": get_inventory,
    "get_demand": get_demand,
}
```

### Tool definitions

Each function declares an input schema and an `output_schema` describing the JSON result. Setting `allowed_callers` to `["programmatic"]` makes the function available to generated programs rather than direct model calls.

```python
tools = [
    {
        "type": "function",
        "name": "get_inventory",
        "description": "Return the SKU and available inventory units.",
        "strict": True,
        "parameters": {
            "type": "object",
            "properties": {"sku": {"type": "string"}},
            "required": ["sku"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "sku": {"type": "string"},
                "available_units": {"type": "number"},
            },
            "required": ["sku", "available_units"],
            "additionalProperties": False,
        },
        "allowed_callers": ["programmatic"],
    }
]
```

Add the demand function and the programmatic tool calling capability to the same list:

```python
tools.extend([
    {
        "type": "function",
        "name": "get_demand",
        "description": "Return the SKU and requested demand units.",
        "strict": True,
        "parameters": {
            "type": "object",
            "properties": {"sku": {"type": "string"}},
            "required": ["sku"],
            "additionalProperties": False,
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "sku": {"type": "string"},
                "requested_units": {"type": "number"},
            },
            "required": ["sku", "requested_units"],
            "additionalProperties": False,
        },
        "allowed_callers": ["programmatic"],
    },
    {"type": "programmatic_tool_calling"},
])
```

### Tool results and caller information

The application dispatches function calls by name and serializes each result. Preserve the call's `caller` information so that the runtime can resume the correct program. Unknown tool names and invalid arguments raise errors rather than returning fabricated results.

```python
def run_tool(call):
    run = implementations.get(call.name)
    if run is None:
        raise ValueError(f"Unknown tool: {call.name}")

    arguments = json.loads(call.arguments)
    if (
        not isinstance(arguments, dict)
        or set(arguments) != {"sku"}
        or not isinstance(arguments["sku"], str)
    ):
        raise ValueError(f"Invalid arguments for tool: {call.name}")

    result = run(**arguments)
    output = {
        "type": "function_call_output",
        "call_id": call.call_id,
        "output": json.dumps(result),
    }
    if call.caller is not None:
        output["caller"] = call.caller.model_dump(exclude_none=True)
    return output
```

### Response continuation

Replace `YOUR-MODEL-DEPLOYMENT` with the name of your supported Azure OpenAI deployment.

With `store=False`, the application carries the conversation forward. Preserve every output item, including program and reasoning items, before adding tool results. The loop stops on a final answer or refusal and raises an error if a response fails or the request limit is reached.

```python
input_items = [
    {"role": "user", "content": "Compare inventory with demand for sku_123."}
]
MAX_REQUESTS = 10
for _ in range(MAX_REQUESTS):
    response = openai.responses.create(
        model="YOUR-MODEL-DEPLOYMENT",
        store=False, input=input_items, tools=tools,
    )
    if response.status != "completed":
        raise RuntimeError(f"Response ended with status {response.status}")
    input_items.extend(
        item.model_dump(exclude_none=True) for item in response.output
    )
    calls = [item for item in response.output if item.type == "function_call"]
    if calls:
        input_items.extend(run_tool(call) for call in calls)
        continue
    if response.output_text:
        print(response.output_text)
        break
    refusals = [
        part.refusal for item in response.output if item.type == "message"
        for part in item.content if part.type == "refusal"
    ]
    if refusals:
        print("\n".join(refusals))
        break
else:
    raise RuntimeError("Programmatic tool calling exceeded the request limit")
```

The final answer should explain that inventory covers demand: 42 available units minus 31 requested units leaves 11 units. The wording can vary. A refusal is printed instead if the model declines the request.

The application executes the inventory and demand functions, while the generated program coordinates their use and processes the results.

## When to use programmatic tool calling

Consider programmatic tool calling when a task:

- Requires several related tool calls.
- Contains conditional logic.
- Needs iteration over tool results.
- Performs intermediate data processing before producing an answer.
- Would otherwise require repeated model turns to coordinate tools.

For simple workflows that involve one or two independent functions, standard function calling might be easier to implement.

## Programmatic tool calling and parallel tool calling

Parallel tool calling and programmatic tool calling address different orchestration needs.

Use **parallel tool calling** when several independent operations can execute at the same time. For example, retrieve weather for five independent locations.

Use **programmatic tool calling** when tool operations require coordination, intermediate computation, branching, or iteration. For example, retrieve a customer's orders, select orders that match a condition, and query shipping information for those orders.

## Programmatic tool calling and tool search

Tool search controls which tool definitions are loaded into the model's context.

Programmatic tool calling controls how the model orchestrates tools after they're available.

The distinction is between tool discovery and tool orchestration. Their conceptual relationship doesn't establish whether your deployment supports using both features in the same request.

## Security considerations

Treat generated programs as untrusted code.

When exposing tools:

- Follow least-privilege principles.
- Validate tool arguments.
- Restrict access to sensitive operations.
- Authenticate and authorize operations independently of model output.
- Log tool execution for auditing and diagnostics without recording secrets or unnecessary sensitive data.
- Avoid exposing unnecessary tools or data.

Don't rely on model-generated code as an authorization boundary.

## Related content

- [Use the Azure OpenAI Responses API](../how-to/responses)
- [Function calling with Azure OpenAI](../how-to/function-calling)
- [Use tool search with the Azure OpenAI Responses API](../how-to/tool-search)
