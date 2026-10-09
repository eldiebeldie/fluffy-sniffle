using System.Text.Json.Serialization;

namespace FluffySniffle.Models;

public record RepoConfig
{
    [JsonPropertyName("owner")]
    public string Owner { get; init; } = string.Empty;

    [JsonPropertyName("repo")]
    public string Repo { get; init; } = string.Empty;

    [JsonIgnore]
    public string FullName => $"{Owner}/{Repo}";
}

public record AppConfig
{
    [JsonPropertyName("defaultStaleDays")]
    public int DefaultStaleDays { get; set; } = 30;

    [JsonPropertyName("warnStaleDays")]
    public int WarnStaleDays { get; set; } = 60;

    [JsonPropertyName("repositories")]
    public List<RepoConfig> Repositories { get; set; } = [];
}
