# Web search

Web search is powered by Web IQ and enables models to retrieve and ground responses with real-time information from the public web before generating output. When enabled, the model can return up-to-date answers with inline citations. You can access web search through the `web_search` tool in the **Responses API**.

Note

In the Azure OpenAI Responses API, use the `web_search` tool for web search. The preview version of the web search tool (`web_search_preview`) is supported but not recommended. It has limitations.

Important

When you connect to Web IQ, you might incur costs and data might be sent outside the Azure compliance boundary and processed according to the [Web IQ terms of use](https://www.microsoft.com/en-us/webiq/webiq-legal) and [Microsoft Privacy Statement](https://www.microsoft.com/en-us/privacy/privacystatement).

[Learn more](#manage-web-search-tool) about how Azure admins can manage access to the use of Web search.

## Prerequisites

- An Azure OpenAI model deployed.
- An authentication method:

    - API key, or
    - Microsoft Entra ID.
- Install the client library for your language:

    - **Python**: `pip install openai azure-identity`
    - **.NET**: `dotnet add package OpenAI` and `dotnet add package Azure.Identity`
    - **JavaScript/TypeScript**: `npm install openai @azure/identity`
    - **Java**: Add `com.openai:openai-java` and `com.azure:azure-identity` to your project.
- For REST examples, set `AZURE_OPENAI_API_KEY` (API key flow) or `AZURE_OPENAI_AUTH_TOKEN` (Microsoft Entra ID flow).

## Options to use web search

Web search supports three modes. Choose the mode based on the depth and speed you need.

### Web search without reasoning

The model forwards the user query directly to the web search tool and uses top-ranked sources to ground the response. There's no multi-step planning. This mode is **fast** and best for quick lookups and timely facts.

### Agentic search with reasoning models

The model actively manages the search process and can perform web searches as part of its chain of thought, analyze results, and decide whether to keep searching. This flexibility makes agentic search well **suited for complex workflows**, but it also means searches take **longer** than quick lookups. For example, use `gpt-5.5` with `reasoning.effort` set to `medium` or `high` to balance search depth and latency.

### Deep research

Deep Research is an agent-driven mode designed for **extended investigations**. The model performs multi-step reasoning, opens and reads many pages, and synthesizes findings into a comprehensive, citation-rich response. Use this mode with `o3-deep-research`, or with `gpt-5.5` and `reasoning.effort` set to `high` or `xhigh`.

Deep Research can run for several minutes and is best for background-style workloads that prioritize completeness over speed.

## How it works

You use web search by declaring the tool `{"type": "web_search"}` in your request. The model decides whether to call the tool based on the user's prompt and your configuration.

Note

Web Search in the Responses API works with GPT-4 models and later.

In the examples that follow, replace `gpt-5.5` with the name of your own model deployment. The same `assert` pattern shown in the basic Microsoft Entra ID snippets applies to the API-key snippets and the user-location and domain-filtering examples.

# [Python](#tab/python)

**Microsoft Entra ID:**

```python
from openai import OpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/"
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)

# Use the OpenAI client with the Azure v1 endpoint.
openai = OpenAI(
    base_url=endpoint,
    api_key=token_provider,
)

response = openai.responses.create(
    model="gpt-5.5",
    tools=[{"type": "web_search"}],
    input="Please perform a web search on the latest trends in renewable energy",
)

print(response.output_text)

# Verify the call succeeded.
assert response.output_text, "Empty output_text"
assert any(item.type == "web_search_call" for item in response.output), \
    "No web_search_call in response"
```

**API key:**

```python
import os
from openai import OpenAI

endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/"

openai = OpenAI(
    base_url=endpoint,
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
)

response = openai.responses.create(
    model="gpt-5.5",
    tools=[{"type": "web_search"}],
    input="Please perform a web search on the latest trends in renewable energy",
)

print(response.output_text)
```

# [C#](#tab/csharp)

**Microsoft Entra ID:**

```csharp
using Azure.Identity;
using OpenAI.Responses;
using System.ClientModel.Primitives;
using System.Diagnostics;

#pragma warning disable OPENAI001

string endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

BearerTokenPolicy tokenPolicy = new(
    new DefaultAzureCredential(),
    "https://ai.azure.com/.default");

ResponsesClient openAIClient = new(
    authenticationPolicy: tokenPolicy,
    options: new ResponsesClientOptions { Endpoint = new Uri(endpoint) });

CreateResponseOptions options = new()
{
    Model = "gpt-5.5",
    Tools = { ResponseTool.CreateWebSearchTool() }
};
options.InputItems.Add(ResponseItem.CreateUserMessageItem(
    "Please perform a web search on the latest trends in renewable energy"));

ResponseResult response = await openAIClient.CreateResponseAsync(options);
Console.WriteLine(response.GetOutputText());

// Verify the call succeeded.
Debug.Assert(!string.IsNullOrEmpty(response.GetOutputText()), "Empty output text");
Debug.Assert(
    response.OutputItems.Any(item => item is WebSearchCallResponseItem),
    "No web_search_call in response");
```

**API key:**

```csharp
using OpenAI.Responses;
using System.ClientModel;

#pragma warning disable OPENAI001

string endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";
string apiKey = Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY")!;

ResponsesClient openAIClient = new(
    credential: new ApiKeyCredential(apiKey),
    options: new ResponsesClientOptions { Endpoint = new Uri(endpoint) });

CreateResponseOptions options = new()
{
    Model = "gpt-5.5",
    Tools = { ResponseTool.CreateWebSearchTool() }
};
options.InputItems.Add(ResponseItem.CreateUserMessageItem(
    "Please perform a web search on the latest trends in renewable energy"));

ResponseResult response = await openAIClient.CreateResponseAsync(options);
Console.WriteLine(response.GetOutputText());
```

# [JavaScript](#tab/javascript)

**Microsoft Entra ID:**

```javascript
// Save this file with the .mjs extension, or add "type": "module" to your package.json.
import { OpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/";
const tokenProvider = getBearerTokenProvider(
  new DefaultAzureCredential(),
  "https://ai.azure.com/.default"
);

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: await tokenProvider(),
});

const response = await openai.responses.create({
  model: "gpt-5.5",
  tools: [{ type: "web_search" }],
  input: "Please perform a web search on the latest trends in renewable energy",
});

console.log(response.output_text);

// Verify the call succeeded.
console.assert(response.output_text, "Empty output_text");
console.assert(
  response.output.some((item) => item.type === "web_search_call"),
  "No web_search_call in response"
);
```

**API key:**

```javascript
import { OpenAI } from "openai";

const endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/";

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: process.env.AZURE_OPENAI_API_KEY,
});

const response = await openai.responses.create({
  model: "gpt-5.5",
  tools: [{ type: "web_search" }],
  input: "Please perform a web search on the latest trends in renewable energy",
});

console.log(response.output_text);
```

# [Java](#tab/java)

**Microsoft Entra ID:**

```java
import com.azure.identity.AuthenticationUtil;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.credential.BearerTokenCredential;
import com.openai.models.responses.Response;
import com.openai.models.responses.ResponseCreateParams;
import com.openai.models.responses.WebSearchTool;

public class WebSearchExample {
    public static void main(String[] args) {
        String endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

        OpenAIClient openAIClient = OpenAIOkHttpClient.builder()
            .baseUrl(endpoint)
            .credential(BearerTokenCredential.create(
                AuthenticationUtil.getBearerTokenSupplier(
                    new DefaultAzureCredentialBuilder().build(),
                    "https://ai.azure.com/.default")))
            .build();

        WebSearchTool webSearchTool = WebSearchTool.builder()
            .type(WebSearchTool.Type.WEB_SEARCH)
            .build();

        ResponseCreateParams params = ResponseCreateParams.builder()
            .model("gpt-5.5")
            .input("Please perform a web search on the latest trends in renewable energy")
            .addTool(webSearchTool)
            .build();

        Response response = openAIClient.responses().create(params);
        response.output().forEach(item -> item.message().ifPresent(msg ->
            msg.content().forEach(content -> content.outputText().ifPresent(
                t -> System.out.println(t.text())))));

        // Verify the call succeeded.
        boolean hasWebSearchCall = response.output().stream()
            .anyMatch(item -> item.webSearchCall().isPresent());
        assert hasWebSearchCall : "No web_search_call in response";
    }
}
```

**API key:**

```java
import com.openai.azure.credential.AzureApiKeyCredential;
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.responses.Response;
import com.openai.models.responses.ResponseCreateParams;
import com.openai.models.responses.WebSearchTool;

public class WebSearchExample {
    public static void main(String[] args) {
        String endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

        OpenAIClient openAIClient = OpenAIOkHttpClient.builder()
            .baseUrl(endpoint)
            .credential(AzureApiKeyCredential.create(System.getenv("AZURE_OPENAI_API_KEY")))
            .build();

        WebSearchTool webSearchTool = WebSearchTool.builder()
            .type(WebSearchTool.Type.WEB_SEARCH)
            .build();

        ResponseCreateParams params = ResponseCreateParams.builder()
            .model("gpt-5.5")
            .input("Please perform a web search on the latest trends in renewable energy")
            .addTool(webSearchTool)
            .build();

        Response response = openAIClient.responses().create(params);
        response.output().forEach(item -> item.message().ifPresent(msg ->
            msg.content().forEach(content -> content.outputText().ifPresent(
                t -> System.out.println(t.text())))));
    }
}
```

# [REST](#tab/rest)

**Microsoft Entra ID:**

```bash
curl -X POST https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_OPENAI_AUTH_TOKEN" \
  -d '{
     "model": "gpt-5.5",
     "tools": [{"type": "web_search"}],
     "input": "Please perform a web search on the latest trends in renewable energy"
    }'
```

The response returns HTTP 200 with a JSON body whose `output` array contains both a `web_search_call` item and a `message` item. If either is missing, the call didn't perform a web search.

**API key:**

```bash
curl -X POST https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/responses \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_OPENAI_API_KEY" \
  -d '{
     "model": "gpt-5.5",
     "tools": [{"type": "web_search"}],
     "input": "Please perform a web search on the latest trends in renewable energy"
    }'
```

---

### Response shape

A successful response that uses web search typically contains two parts:

```json
[
    {
      "id": "ws_68b9d1220b288199bf942a3e48055f3602e3b78a8dbf73ac",
      "type": "web_search_call",
      "status": "completed",
      "action": {
        "type": "search",
        "query": "latest trends in renewable energy 2025"
      }
    },
    {
      "id": "msg_68b9d123f4788199a544b6b97e65673e02e3b78a8dbf73ac",
      "type": "message",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "annotations": [
            {
                "type": "url_citation",
                "start_index": 1358,
                "end_index": 1462,
                "url": "https://...",
                "title": "Title..."
            }
        ],
          "text": "If you're searching for uplifting....."
        }
      ],
    }
  ]
```

- A `web_search_call` output item that records the action performed:

    - `search`: a web search action, including the query and optionally the searched domains.
    - `open_page`: indicates the agent opened a page. Available with all reasoning models.
    - `find_in_page`: indicates the agent searched within an opened page. Available with all reasoning models.
- A message output item containing:

    - The grounded text in `message.content[0].text`.
    - URL citations in `message.content[0].annotations`, one or more `url_citation` objects that include the URL, title, and character ranges.

When you use a reasoning model, the `output` array also contains a `reasoning` item alongside `web_search_call` and `message`. Parse the array by `type` rather than by position.

### Web search usage and billing

Web search charges are based on the number of Bing search requests. Use `tool_usage.web_search.num_requests` in the response body to identify this count. The request count is available for all models that support web search.

Don't calculate billable usage by counting `search` actions or `web_search_call` output items. These counts don't reliably represent the number of Bing search requests. For rates, see [Grounding with Bing pricing](https://www.microsoft.com/en-us/bing/apis).

### Control results by user location

You can refine search results by passing the approximate user location. The following fields are supported:

| Field | Description | Example |
| --- | --- | --- |
| `country` | Two-letter [ISO country/region code](https://en.wikipedia.org/wiki/ISO_3166-1). | `US` |
| `city` | Free-text city name. | `Chicago` |
| `region` | Free-text region or state name. | `Illinois` |
| `timezone` | [IANA time zone identifier](https://www.iana.org/time-zones). | `America/Chicago` |

Note

The `city`, `region`, and `timezone` fields are only supported when you use the `web_search` tool.

# [Python](#tab/python)

```python
from openai import OpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/"
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)

openai = OpenAI(base_url=endpoint, api_key=token_provider)

response = openai.responses.create(
    model="gpt-5.5",
    tools=[
        {
            "type": "web_search",
            "user_location": {
                "type": "approximate",
                "country": "US",
                "city": "Chicago",
                "region": "Illinois",
                "timezone": "America/Chicago",
            },
        }
    ],
    input="Give me a positive news story from the web today in my city",
)

print(response.output_text)
```

# [C#](#tab/csharp)

```csharp
using Azure.Identity;
using OpenAI.Responses;
using System.ClientModel.Primitives;

#pragma warning disable OPENAI001

string endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

BearerTokenPolicy tokenPolicy = new(
    new DefaultAzureCredential(),
    "https://ai.azure.com/.default");

ResponsesClient openAIClient = new(
    authenticationPolicy: tokenPolicy,
    options: new ResponsesClientOptions { Endpoint = new Uri(endpoint) });

WebSearchToolApproximateLocation location =
    WebSearchToolLocation.CreateApproximateLocation(
        country: "US",
        region: "Illinois",
        city: "Chicago",
        timezone: "America/Chicago");

CreateResponseOptions options = new()
{
    Model = "gpt-5.5",
    Tools = { ResponseTool.CreateWebSearchTool(userLocation: location) }
};
options.InputItems.Add(ResponseItem.CreateUserMessageItem(
    "Give me a positive news story from the web today in my city"));

ResponseResult response = await openAIClient.CreateResponseAsync(options);
Console.WriteLine(response.GetOutputText());
```

# [JavaScript](#tab/javascript)

```javascript
import { OpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/";
const tokenProvider = getBearerTokenProvider(
  new DefaultAzureCredential(),
  "https://ai.azure.com/.default"
);

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: await tokenProvider(),
});

const response = await openai.responses.create({
  model: "gpt-5.5",
  tools: [
    {
      type: "web_search",
      user_location: {
        type: "approximate",
        country: "US",
        city: "Chicago",
        region: "Illinois",
        timezone: "America/Chicago",
      },
    },
  ],
  input: "Give me a positive news story from the web today in my city",
});

console.log(response.output_text);
```

# [Java](#tab/java)

```java
import com.azure.identity.AuthenticationUtil;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.credential.BearerTokenCredential;
import com.openai.models.responses.Response;
import com.openai.models.responses.ResponseCreateParams;
import com.openai.models.responses.WebSearchTool;
import com.openai.models.responses.WebSearchTool.UserLocation;

public class WebSearchLocationExample {
    public static void main(String[] args) {
        String endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

        OpenAIClient openAIClient = OpenAIOkHttpClient.builder()
            .baseUrl(endpoint)
            .credential(BearerTokenCredential.create(
                AuthenticationUtil.getBearerTokenSupplier(
                    new DefaultAzureCredentialBuilder().build(),
                    "https://ai.azure.com/.default")))
            .build();

        WebSearchTool webSearchTool = WebSearchTool.builder()
            .type(WebSearchTool.Type.WEB_SEARCH)
            .userLocation(UserLocation.builder()
                .country("US")
                .city("Chicago")
                .region("Illinois")
                .timezone("America/Chicago")
                .build())
            .build();

        ResponseCreateParams params = ResponseCreateParams.builder()
            .model("gpt-5.5")
            .input("Give me a positive news story from the web today in my city")
            .addTool(webSearchTool)
            .build();

        Response response = openAIClient.responses().create(params);
        response.output().forEach(item -> item.message().ifPresent(msg ->
            msg.content().forEach(content -> content.outputText().ifPresent(
                t -> System.out.println(t.text())))));
    }
}
```

# [REST](#tab/rest)

```bash
curl -X POST https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_OPENAI_AUTH_TOKEN" \
  -d '{
    "model": "gpt-5.5",
    "tools": [
        {
            "type": "web_search",
            "user_location": {
                "type": "approximate",
                "country": "US",
                "city": "Chicago",
                "region": "Illinois",
                "timezone": "America/Chicago"
            }
        }
    ],
    "input": "Give me a positive news story from the web today in my city"
    }'
```

---

To use API key authentication, replace the Microsoft Entra credential with your API key as shown in the [basic example](#how-it-works).

### Domain filtering

You can limit results to a specific set of domains by using domain filtering. Use the `allowed_domains` field to allowlist up to 100 URLs, or the `blocked_domains` field to exclude domains from results. You can omit the HTTP or HTTPS prefix when formatting the URLs. For example, use `microsoft.com` instead of `https://www.microsoft.com/`. Subdomains are also included in the search. Domain filtering works with the `web_search` tool only in the Responses API.

Note

The OpenAI .NET and Java SDKs don't yet expose typed builders for `blocked_domains`. The C# and Java examples here use the SDKs' public escape hatches (`JsonPatch.Set` for .NET, `putAdditionalProperty` for Java) to set the field. When typed builders ship, replace those calls with the typed equivalents.

To return the sources the model consulted, set `include` to `["web_search_call.action.sources"]`. The matched source URLs appear in the `action.sources` array of the `web_search_call` output item. Each entry contains a `type` and a `url`. Page titles aren't returned in `action.sources`; the model's grounded text includes titles in the `url_citation` annotations on the message item instead.

To return the search result snippets the model consulted, set `include` to `["web_search_call.results"]`. The `web_search_call.results` option is supported only when you use a reasoning model.

In Azure OpenAI, `open_page` and `find_in_page` don't return results to your application through `web_search_call.results`, even when you request this option.

The model can still access cached content when available. This content isn't retrieved live from the website. Missing results don't necessarily mean the model had no content available.

# [Python](#tab/python)

```python
from openai import OpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/"
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)

openai = OpenAI(base_url=endpoint, api_key=token_provider)

response = openai.responses.create(
    model="gpt-5.5",
    reasoning={"effort": "low"},
    tools=[
        {
            "type": "web_search",
            "filters": {
                "allowed_domains": [
                    "pubmed.ncbi.nlm.nih.gov",
                    "clinicaltrials.gov",
                    "www.who.int",
                    "www.cdc.gov",
                    "www.fda.gov",
                ],
                "blocked_domains": [
                    "en.wikipedia.org",
                    "www.reddit.com",
                ],
            },
        }
    ],
    tool_choice="auto",
    include=["web_search_call.action.sources"],
    input="Please perform a web search on how semaglutide is used in the treatment of diabetes.",
)

print(response.output_text)
```

# [C#](#tab/csharp)

```csharp
using Azure.Identity;
using OpenAI.Responses;
using System.ClientModel.Primitives;

#pragma warning disable OPENAI001

string endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

BearerTokenPolicy tokenPolicy = new(
    new DefaultAzureCredential(),
    "https://ai.azure.com/.default");

ResponsesClient openAIClient = new(
    authenticationPolicy: tokenPolicy,
    options: new ResponsesClientOptions { Endpoint = new Uri(endpoint) });

WebSearchToolFilters filters = new();
filters.AllowedDomains.Add("pubmed.ncbi.nlm.nih.gov");
filters.AllowedDomains.Add("clinicaltrials.gov");
filters.AllowedDomains.Add("www.who.int");
filters.AllowedDomains.Add("www.cdc.gov");
filters.AllowedDomains.Add("www.fda.gov");

// blocked_domains isn't yet a typed property on WebSearchToolFilters; use the
// JsonPatch escape hatch until the typed setter ships in OpenAI.Responses.
#pragma warning disable SCME0001
filters.Patch.Set("$.blocked_domains"u8,
    """["en.wikipedia.org","www.reddit.com"]"""u8);
#pragma warning restore SCME0001

CreateResponseOptions options = new()
{
    Model = "gpt-5.5",
    ReasoningOptions = new ResponseReasoningOptions { ReasoningEffortLevel = ResponseReasoningEffortLevel.Low },
    Tools = { ResponseTool.CreateWebSearchTool(filters: filters) },
    ToolChoice = ResponseToolChoice.CreateAutoChoice(),
    IncludedProperties = { IncludedResponseProperty.WebSearchCallActionSources }
};
options.InputItems.Add(ResponseItem.CreateUserMessageItem(
    "Please perform a web search on how semaglutide is used in the treatment of diabetes."));

ResponseResult response = await openAIClient.CreateResponseAsync(options);
Console.WriteLine(response.GetOutputText());
```

# [JavaScript](#tab/javascript)

```javascript
import { OpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/";
const tokenProvider = getBearerTokenProvider(
  new DefaultAzureCredential(),
  "https://ai.azure.com/.default"
);

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: await tokenProvider(),
});

const response = await openai.responses.create({
  model: "gpt-5.5",
  reasoning: { effort: "low" },
  tools: [
    {
      type: "web_search",
      filters: {
        allowed_domains: [
          "pubmed.ncbi.nlm.nih.gov",
          "clinicaltrials.gov",
          "www.who.int",
          "www.cdc.gov",
          "www.fda.gov",
        ],
        blocked_domains: [
          "en.wikipedia.org",
          "www.reddit.com",
        ],
      },
    },
  ],
  tool_choice: "auto",
  include: ["web_search_call.action.sources"],
  input: "Please perform a web search on how semaglutide is used in the treatment of diabetes.",
});

console.log(response.output_text);
```

# [Java](#tab/java)

```java
import com.azure.identity.AuthenticationUtil;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.core.JsonValue;
import com.openai.credential.BearerTokenCredential;
import com.openai.models.responses.Response;
import com.openai.models.responses.ResponseCreateParams;
import com.openai.models.responses.ResponseIncludable;
import com.openai.models.responses.ToolChoiceOptions;
import com.openai.models.responses.WebSearchTool;
import com.openai.models.responses.WebSearchTool.Filters;
import java.util.List;

public class WebSearchDomainFilterExample {
    public static void main(String[] args) {
        String endpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1";

        OpenAIClient openAIClient = OpenAIOkHttpClient.builder()
            .baseUrl(endpoint)
            .credential(BearerTokenCredential.create(
                AuthenticationUtil.getBearerTokenSupplier(
                    new DefaultAzureCredentialBuilder().build(),
                    "https://ai.azure.com/.default")))
            .build();

        WebSearchTool webSearchTool = WebSearchTool.builder()
            .type(WebSearchTool.Type.WEB_SEARCH)
            .filters(Filters.builder()
                .addAllowedDomain("pubmed.ncbi.nlm.nih.gov")
                .addAllowedDomain("clinicaltrials.gov")
                .addAllowedDomain("www.who.int")
                .addAllowedDomain("www.cdc.gov")
                .addAllowedDomain("www.fda.gov")
                // blocked_domains isn't yet a typed builder on Filters; use
                // putAdditionalProperty until addBlockedDomain ships in openai-java.
                .putAdditionalProperty("blocked_domains", JsonValue.from(List.of(
                    "en.wikipedia.org",
                    "www.reddit.com")))
                .build())
            .build();

        ResponseCreateParams params = ResponseCreateParams.builder()
            .model("gpt-5.5")
            .input("Please perform a web search on how semaglutide is used in the treatment of diabetes.")
            .addTool(webSearchTool)
            .toolChoice(ToolChoiceOptions.AUTO)
            .addInclude(ResponseIncludable.WEB_SEARCH_CALL_ACTION_SOURCES)
            .build();

        Response response = openAIClient.responses().create(params);
        response.output().forEach(item -> item.message().ifPresent(msg ->
            msg.content().forEach(content -> content.outputText().ifPresent(
                t -> System.out.println(t.text())))));
    }
}
```

# [REST](#tab/rest)

```bash
curl -X POST https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_OPENAI_AUTH_TOKEN" \
  -d '{
    "model": "gpt-5.5",
    "reasoning": { "effort": "low" },
    "tools": [
      {
        "type": "web_search",
        "filters": {
          "allowed_domains": [
            "pubmed.ncbi.nlm.nih.gov",
            "clinicaltrials.gov",
            "www.who.int",
            "www.cdc.gov",
            "www.fda.gov"
          ],
          "blocked_domains": [
            "en.wikipedia.org",
            "www.reddit.com"
          ]
        }
      }
    ],
    "tool_choice": "auto",
    "include": ["web_search_call.action.sources"],
    "input": "Please perform a web search on how semaglutide is used in the treatment of diabetes."
  }'
```

---

To use API key authentication, replace the Microsoft Entra credential with your API key as shown in the [basic example](#how-it-works).

### Limitations

- Live internet access isn't supported. Azure OpenAI always treats the `external_web_access` parameter as `false`.
- The domain allow list supports up to 100 URLs.
- Web search charges are based on Bing search requests reported in `tool_usage.web_search.num_requests`, not the number of `search` actions. For more information, see [Web search usage and billing](#web-search-usage-and-billing).
- The preview version of the web search tool (`web_search_preview`) is supported but not recommended.
- The `open_page` and `find_in_page` actions are available only with reasoning models. These actions don't return results through `web_search_call.results`.

## Manage web search tool

You can enable or disable the `web_search` tool in the Responses API at the subscription level by using Azure CLI. This setting applies to all accounts within the specified subscription.

### Prerequisites

Before running the following commands, make sure you have the following prerequisites:

- [Azure CLI](/en-us/cli/azure/install-azure-cli) installed.
- You're signed in to Azure by using `az login`.
- You have **Owner** or **Contributor** access to the subscription.

### Disable web search

To disable the `web_search` tool for all accounts in a subscription:

```bash
az feature register --name OpenAI.BlockedTools.web_search --namespace Microsoft.CognitiveServices --subscription "<subscription-id>"
```

This command disables web search across all accounts in the specified subscription.

### Enable web search

To enable the `web_search` tool:

```bash
az feature unregister --name OpenAI.BlockedTools.web_search --namespace Microsoft.CognitiveServices --subscription "<subscription-id>"
```

This command enables web search functionality for all accounts in the subscription.

## Troubleshooting

- **No citations returned**: Confirm your request includes `tools: [{"type": "web_search"}]`. If the model doesn't call the tool, prompt more explicitly to browse the web or ask for citations.
- **Tool is blocked**: Ask your subscription admin to verify the subscription feature setting for blocked tools. See [Manage web search tool](#manage-web-search-tool).
- **Authentication errors**: For API keys, verify you set `AZURE_OPENAI_API_KEY`. For Microsoft Entra ID, verify your token scope is `https://ai.azure.com/.default`.

## Image search results

Image search is a separate search flavor alongside general web search and custom search. Like general web search, image search is powered by Web IQ. Use it to find product photos, landmarks, or other visual references, with optional supporting text.

Note

Custom search is powered by Grounding with Bing Custom Search and doesn't support image search.

Configure image search on the `web_search` tool:

- Set `search_content_types` to `["image"]` for image results, or `["image", "text"]` for images with supporting text results.
- Set `image_settings.max_results` to a positive number to request that many image results.
- Set `image_settings.caption` to `true` to request short image descriptions when available.

Add `"web_search_call.results"` to the request's `include` array to return the raw image results.

The following examples send the image-search settings as JSON because typed SDK models might not expose these fields. Set `AZURE_OPENAI_ENDPOINT` to `https://YOUR-RESOURCE-NAME.openai.azure.com` and replace `YOUR-MODEL-DEPLOYMENT-NAME` with your model deployment name.

For API-key authentication, set `AZURE_OPENAI_API_KEY`. For the C#, JavaScript/TypeScript, Java, and REST Microsoft Entra ID examples, sign in with `az login` and get a token:

```bash
export AZURE_OPENAI_AUTH_TOKEN=$(az account get-access-token \
  --scope "https://ai.azure.com/.default" --query accessToken -o tsv)
```

### Choose a language

Select a language to send the same image-search request. The Python examples use the `openai` package; the other examples use HTTP clients.

# [Python](#tab/image-python)

Use `extra_body` to send the image-search fields without relying on typed SDK support. Both examples print the full response, including the raw image results.

#### API key

```python
import os

from openai import OpenAI

with OpenAI(
    base_url=os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/") + "/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
) as image_key_client:
    image_key_response = image_key_client.responses.create(
        model="YOUR-MODEL-DEPLOYMENT-NAME",
        input="Find images of the Golden Gate Bridge with supporting text.",
        extra_body={
            "tools": [
                {
                    "type": "web_search",
                    "search_content_types": ["image", "text"],
                    "image_settings": {"max_results": 3, "caption": True},
                }
            ],
            "include": ["web_search_call.results"],
        },
    )
    print(image_key_response.model_dump_json(indent=2))
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses).

#### Microsoft Entra ID

Install `azure-identity` as well as `openai`. This example uses `DefaultAzureCredential` instead of a manually acquired token.

```python
import os

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

image_token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)

with OpenAI(
    base_url=os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/") + "/openai/v1/",
    api_key=image_token_provider,
) as image_entra_client:
    image_entra_response = image_entra_client.responses.create(
        model="YOUR-MODEL-DEPLOYMENT-NAME",
        input="Find images of the Golden Gate Bridge with supporting text.",
        extra_body={
            "tools": [
                {
                    "type": "web_search",
                    "search_content_types": ["image", "text"],
                    "image_settings": {"max_results": 3, "caption": True},
                }
            ],
            "include": ["web_search_call.results"],
        },
    )
    print(image_entra_response.model_dump_json(indent=2))
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses), [Azure Identity](/en-us/python/api/azure-identity/azure.identity).

# [C#](#tab/image-csharp)

This example uses .NET 8 or later and the Microsoft Entra ID token acquired earlier.

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

string imageOpenAIEndpoint =
    Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")
    ?? throw new InvalidOperationException("Set AZURE_OPENAI_ENDPOINT.");
string imageAuthToken =
    Environment.GetEnvironmentVariable("AZURE_OPENAI_AUTH_TOKEN")
    ?? throw new InvalidOperationException("Set AZURE_OPENAI_AUTH_TOKEN.");

using HttpClient imageHttpClient = new();
using HttpRequestMessage imageRequest = new(
    HttpMethod.Post,
    $"{imageOpenAIEndpoint.TrimEnd('/')}/openai/v1/responses");
imageRequest.Headers.Authorization =
    new AuthenticationHeaderValue("Bearer", imageAuthToken);
imageRequest.Content = new StringContent(
    """
    {
      "model": "YOUR-MODEL-DEPLOYMENT-NAME",
      "tools": [{
        "type": "web_search",
        "search_content_types": ["image", "text"],
        "image_settings": {"max_results": 3, "caption": true}
      }],
      "include": ["web_search_call.results"],
      "input": "Find images of the Golden Gate Bridge with supporting text."
    }
    """,
    Encoding.UTF8,
    "application/json");

using HttpResponseMessage imageHttpResponse =
    await imageHttpClient.SendAsync(imageRequest);
string imageResponseJson = await imageHttpResponse.Content.ReadAsStringAsync();
if (!imageHttpResponse.IsSuccessStatusCode)
{
    throw new HttpRequestException(
        $"{imageHttpResponse.StatusCode}: {imageResponseJson}");
}
Console.WriteLine(imageResponseJson);
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses), [HttpClient](/en-us/dotnet/api/system.net.http.httpclient).

# [JavaScript/TypeScript](#tab/image-javascript)

This JavaScript example also works in TypeScript. Run it as an ES module in Node.js 20 or later, using the Microsoft Entra ID token acquired earlier.

```javascript
const imageOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const imageAuthToken = process.env.AZURE_OPENAI_AUTH_TOKEN;
if (!imageOpenAIEndpoint || !imageAuthToken) {
  throw new Error("Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_AUTH_TOKEN.");
}

const imageResponse = await fetch(
  `${imageOpenAIEndpoint.replace(/\/$/, "")}/openai/v1/responses`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${imageAuthToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "YOUR-MODEL-DEPLOYMENT-NAME",
      tools: [{
        type: "web_search",
        search_content_types: ["image", "text"],
        image_settings: { max_results: 3, caption: true },
      }],
      include: ["web_search_call.results"],
      input: "Find images of the Golden Gate Bridge with supporting text.",
    }),
  },
);
const imageResponseBody = await imageResponse.text();
if (!imageResponse.ok) {
  throw new Error(`${imageResponse.status}: ${imageResponseBody}`);
}
console.log(imageResponseBody);
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses).

# [Java](#tab/image-java)

This example uses Java 17 or later and the Microsoft Entra ID token you acquired earlier.

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Objects;

public class ImageSearchExample {
    public static void main(String[] args) throws Exception {
        String endpoint = Objects.requireNonNull(
            System.getenv("AZURE_OPENAI_ENDPOINT"),
            "Set AZURE_OPENAI_ENDPOINT.");
        String token = Objects.requireNonNull(
            System.getenv("AZURE_OPENAI_AUTH_TOKEN"),
            "Set AZURE_OPENAI_AUTH_TOKEN.");
        String body = """
            {
              "model": "YOUR-MODEL-DEPLOYMENT-NAME",
              "tools": [{
                "type": "web_search",
                "search_content_types": ["image", "text"],
                "image_settings": {"max_results": 3, "caption": true}
              }],
              "include": ["web_search_call.results"],
              "input": "Find images of the Golden Gate Bridge."
            }
            """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(endpoint.replaceAll("/$", "")
                + "/openai/v1/responses"))
            .header("Authorization", "Bearer " + token)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(
            request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException(
                response.statusCode() + ": " + response.body());
        }
        System.out.println(response.body());
    }
}
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses).

# [REST](#tab/image-rest)

Choose the authentication method for your resource. Both examples return the full response JSON, including the raw image results.

#### API key

```bash
curl --fail-with-body --request POST \
  --url "$AZURE_OPENAI_ENDPOINT/openai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_OPENAI_API_KEY" \
  -d '{
    "model": "YOUR-MODEL-DEPLOYMENT-NAME",
    "tools": [
      {
        "type": "web_search",
        "search_content_types": ["image", "text"],
        "image_settings": {
          "max_results": 3,
          "caption": true
        }
      }
    ],
    "include": ["web_search_call.results"],
    "input": "Find images of the Golden Gate Bridge with supporting text."
  }'
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses).

#### Microsoft Entra ID

Use the Microsoft Entra ID token you acquired earlier.

```bash
curl --fail-with-body --request POST \
  --url "$AZURE_OPENAI_ENDPOINT/openai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_OPENAI_AUTH_TOKEN" \
  -d '{
    "model": "YOUR-MODEL-DEPLOYMENT-NAME",
    "tools": [{
      "type": "web_search",
      "search_content_types": ["image", "text"],
      "image_settings": {"max_results": 3, "caption": true}
    }],
    "include": ["web_search_call.results"],
    "input": "Find images of the Golden Gate Bridge with supporting text."
  }'
```

Reference: [Responses API](/en-us/rest/api/microsoft-foundry/azureopenai/responses).

---

When the model performs an image search, read the `results` array on the `web_search_call` output item. Image results are separate from the assistant's message, so don't rely on `output_text` to retrieve image URLs or metadata. Each `image_result` contains:

- `image_url`: The image URL.
- `source_website_url`: The page where the image was found.
- `thumbnail_url`: A thumbnail URL, when available.
- `caption`: A short description, when available.
