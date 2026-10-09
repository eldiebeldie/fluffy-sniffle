using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace FluffySniffle.Services;

public class SseBroadcaster
{
    private readonly ConcurrentDictionary<Guid, HttpResponse> _clients = new();

    public int ClientCount => _clients.Count;

    public void Register(Guid id, HttpResponse response)
    {
        _clients.TryAdd(id, response);
    }

    public void Unregister(Guid id)
    {
        _clients.TryRemove(id, out _);
    }

    public async Task BroadcastReloadAsync(string reason = "change")
    {
        if (_clients.IsEmpty) return;

        AppLogger.Action("Live Reload", $"Broadcasting reload to {_clients.Count} browser(s) ({reason})");
        var payload = JsonSerializer.Serialize(new { reason, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        var message = $"event: reload\ndata: {payload}\n\n";
        var bytes = Encoding.UTF8.GetBytes(message);

        foreach (var (id, client) in _clients)
        {
            try
            {
                await client.Body.WriteAsync(bytes);
                await client.Body.FlushAsync();
            }
            catch
            {
                _clients.TryRemove(id, out _);
            }
        }
    }
}
