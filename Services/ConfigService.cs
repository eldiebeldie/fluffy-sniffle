using System.Text.Json;
using FluffySniffle.Models;

namespace FluffySniffle.Services;

public class ConfigService
{
    private readonly string _configPath;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public ConfigService(string? configPath = null)
    {
        _configPath = configPath ?? Path.Combine(Directory.GetCurrentDirectory(), "config.json");
    }

    public string ConfigPath => _configPath;

    public AppConfig LoadConfig()
    {
        if (File.Exists(_configPath))
        {
            try
            {
                var json = File.ReadAllText(_configPath);
                var config = JsonSerializer.Deserialize<AppConfig>(json, JsonOptions);
                if (config != null)
                {
                    return config;
                }
            }
            catch (Exception ex)
            {
                AppLogger.Error($"Error reading config.json: {ex.Message}");
            }
        }

        return new AppConfig
        {
            DefaultStaleDays = 30,
            WarnStaleDays = 60,
            Repositories = []
        };
    }

    public void SaveConfig(AppConfig config)
    {
        try
        {
            var json = JsonSerializer.Serialize(config, JsonOptions);
            File.WriteAllText(_configPath, json);
            AppLogger.Info($"Updated {_configPath}");
        }
        catch (Exception ex)
        {
            AppLogger.Error($"Failed to save config: {ex.Message}");
            throw;
        }
    }
}
