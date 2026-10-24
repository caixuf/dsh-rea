// Minimal launcher so tools that use execFile (no shell) can drive apktool on
// Windows: CreateProcess cannot execute a .bat/.cmd directly (spawn EINVAL).
// Usage: ApktoolLauncher.exe <apktool args...>  ->  java -jar apktool.jar <args>
//
// java.exe resolution order:
//   1. $JAVA_HOME\bin\java.exe
//   2. java-path.txt next to this launcher (one absolute JDK dir per line)
//   3. java.exe on PATH
using System;
using System.Diagnostics;
using System.IO;

class ApktoolLauncher
{
    static string ResolveJava(string root)
    {
        string home = Environment.GetEnvironmentVariable("JAVA_HOME");
        if (!string.IsNullOrEmpty(home))
        {
            string candidate = Path.Combine(home, "bin", "java.exe");
            if (File.Exists(candidate)) return candidate;
        }

        string listFile = Path.Combine(root, "java-path.txt");
        if (File.Exists(listFile))
        {
            foreach (string line in File.ReadAllLines(listFile))
            {
                string trimmed = line.Trim();
                if (trimmed.Length == 0 || trimmed.StartsWith("#")) continue;
                string candidate = trimmed.EndsWith("java.exe")
                    ? trimmed
                    : Path.Combine(trimmed, "bin", "java.exe");
                if (File.Exists(candidate)) return candidate;
            }
        }

        string pathDirs = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in pathDirs.Split(Path.PathSeparator))
        {
            if (dir.Length == 0) continue;
            string candidate = Path.Combine(dir, "java.exe");
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    static int Main(string[] args)
    {
        string root = Path.GetDirectoryName(Path.GetFullPath(
            System.Reflection.Assembly.GetExecutingAssembly().Location));
        string jar = Path.Combine(root, "apktool.jar");
        string java = ResolveJava(root);

        if (!File.Exists(jar)) { Console.Error.WriteLine("apktool.jar not found next to launcher: " + jar); return 2; }
        if (java == null) { Console.Error.WriteLine("java.exe not found (JAVA_HOME, java-path.txt, PATH)"); return 2; }

        var psi = new ProcessStartInfo(java);
        psi.Arguments = "\"-jar\" \"" + jar + "\" " + string.Join(" ", args);
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = false;
        psi.RedirectStandardError = false;
        psi.WorkingDirectory = Environment.CurrentDirectory;

        using (Process p = Process.Start(psi))
        {
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
