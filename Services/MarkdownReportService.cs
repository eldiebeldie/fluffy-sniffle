using System.Text;
using FluffySniffle.Models;

namespace FluffySniffle.Services;

public static class MarkdownReportService
{
    public static string SaveMarkdownReport(
        List<RepositoryHealthResult> results,
        List<ContributorActivity>? userActivities = null,
        string outputDir = "reports")
    {
        if (!Directory.Exists(outputDir))
        {
            Directory.CreateDirectory(outputDir);
        }

        var dateStr = DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss");
        var filePath = Path.Combine(outputDir, $"repo-health-{dateStr}.md");

        var sb = new StringBuilder();
        sb.AppendLine("# GitHub Repository Health Report\n");
        sb.AppendLine($"_Generated on: {DateTime.UtcNow:R}_\n");

        // Overview Table
        sb.AppendLine("## Overview\n");
        sb.AppendLine("| Repository | Branches | Stale Branches | Open PRs | Stale PRs | Draft PRs |");
        sb.AppendLine("| :--- | :---: | :---: | :---: | :---: | :---: |");
        foreach (var r in results)
        {
            sb.AppendLine($"| [{r.FullName}](https://github.com/{r.FullName}) | {r.TotalBranches} | {r.StaleBranchesCount} | {r.TotalOpenPrs} | {r.StalePrsCount} | {r.DraftPrsCount} |");
        }
        sb.AppendLine("\n---\n");

        // Contributor Activities Table
        if (userActivities != null && userActivities.Count > 0)
        {
            sb.AppendLine("## 👤 Contributor Activities Overview (All-Time & Attention)\n");
            sb.AppendLine("| Contributor | Repositories | All PRs | Merged | Open | Branches | Stale Branches | Items to Review |");
            sb.AppendLine("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
            foreach (var u in userActivities)
            {
                var repos = string.Join(", ", u.Repositories);
                sb.AppendLine($"| [{u.Username}](https://github.com/{u.Username}) | {repos} | {u.AllPrsCount} | {u.MergedPrsCount} | {u.OpenPrsCount} | {u.AllBranchesCount} | {u.StaleBranchesCount} | {u.TotalNeedsAttention} |");
            }
            sb.AppendLine("\n---\n");
        }

        // Details per repo
        foreach (var r in results)
        {
            sb.AppendLine($"## [{r.FullName}](https://github.com/{r.FullName})\n");

            sb.AppendLine($"### Stale Branches ({r.StaleBranchesCount})\n");
            if (r.StaleBranches.Count == 0)
            {
                sb.AppendLine("No stale branches.\n");
            }
            else
            {
                sb.AppendLine("| Branch | Days Inactive | Last Author | Has Open PR |");
                sb.AppendLine("| :--- | :---: | :--- | :---: |");
                foreach (var b in r.StaleBranches)
                {
                    sb.AppendLine($"| `{b.Name}` | {b.DaysInactive}d | {b.Author} | {(b.HasOpenPr ? "Yes" : "No")} |");
                }
                sb.AppendLine();
            }

            sb.AppendLine($"### Open Pull Requests ({r.TotalOpenPrs})\n");
            if (r.PullRequests.Count == 0)
            {
                sb.AppendLine("No open pull requests.\n");
            }
            else
            {
                sb.AppendLine("| PR | Title | Author | Age | Inactive For | Status |");
                sb.AppendLine("| :--- | :--- | :--- | :---: | :---: | :---: |");
                foreach (var pr in r.PullRequests)
                {
                    var cleanTitle = pr.Title.Replace("|", "\\|");
                    var status = pr.IsDraft ? "Draft" : "Ready";
                    sb.AppendLine($"| [#{pr.Number}]({pr.Url}) | {cleanTitle} | {pr.Author} | {pr.AgeDays}d | {pr.DaysSinceLastUpdate}d | {status} |");
                }
                sb.AppendLine();
            }

            sb.AppendLine("---\n");
        }

        var md = sb.ToString();
        File.WriteAllText(filePath, md, Encoding.UTF8);

        AppLogger.Action("Save Markdown Report", filePath);
        AppLogger.Success($"Markdown report successfully written ({md.Length} characters)");

        return filePath;
    }
}
