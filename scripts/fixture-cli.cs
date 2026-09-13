// Offline CLI fixture for packaged tests. No network calls or real credentials.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
public class FixtureCli {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  public static void Main() {
    string line;
    while ((line = Console.ReadLine()) != null) {
      var id = Regex.Match(line, "\"id\"\\s*:\\s*(\\d+)");
      if (!id.Success) continue;
      var result = "{}";
      if (line.Contains("account/read")) result = "{\"account\":{\"type\":\"chatgpt\",\"email\":\"test@example.invalid\",\"planType\":\"prolite\"}}";
      if (line.Contains("account/rateLimits/read")) {
        result = "{\"rateLimits\":{\"planType\":\"prolite\"}}";
        File.WriteAllText(Environment.GetEnvironmentVariable("CAM_TEST_CLI_MARKER"), "{\"consoleVisible\":" + (IsWindowVisible(GetConsoleWindow()) ? "true" : "false") + "}");
      }
      Console.WriteLine("{\"id\":" + id.Groups[1].Value + ",\"result\":" + result + "}");
    }
  }
}
