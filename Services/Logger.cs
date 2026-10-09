namespace FluffySniffle.Services;

public static class AppLogger
{
    private static readonly object LockObj = new();

    private static string Timestamp => DateTime.Now.ToString("HH:mm:ss.fff");

    public static void Info(string message)
    {
        lock (LockObj)
        {
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"[{Timestamp}] ");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.Write("[INFO] ");
            Console.ResetColor();
            Console.WriteLine(message);
        }
    }

    public static void Success(string message)
    {
        lock (LockObj)
        {
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"[{Timestamp}] ");
            Console.ForegroundColor = ConsoleColor.Green;
            Console.Write("[SUCCESS] ");
            Console.ResetColor();
            Console.WriteLine(message);
        }
    }

    public static void Warn(string message)
    {
        lock (LockObj)
        {
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"[{Timestamp}] ");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.Write("[WARN] ");
            Console.ResetColor();
            Console.WriteLine(message);
        }
    }

    public static void Error(string message)
    {
        lock (LockObj)
        {
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"[{Timestamp}] ");
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Write("[ERROR] ");
            Console.ResetColor();
            Console.WriteLine(message);
        }
    }

    public static void Action(string action, string message)
    {
        lock (LockObj)
        {
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"[{Timestamp}] ");
            Console.ForegroundColor = ConsoleColor.Magenta;
            Console.Write($"[ACTION: {action}] ");
            Console.ResetColor();
            Console.WriteLine(message);
        }
    }
}
