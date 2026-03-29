using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace Aryx.AgentHost.Services;

internal static class JsonSerialization
{
    public static JsonSerializerOptions CreateWebOptions()
    {
        return new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
        };
    }
}
