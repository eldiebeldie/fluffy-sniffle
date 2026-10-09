using FluffySniffle.Models;
using Spectre.Console;

namespace FluffySniffle.Services;

public static class CliReportService
{
    public static void PrintOverviewTable(List<RepositoryHealthResult> results)
    {
        AnsiConsole.WriteLine();
        AnsiConsole.MarkupLine("[bold cyan]📊 GitHub Repositories Health Overview[/]");

        var table = new Table().Border(TableBorder.Rounded);
        table.AddColumn(new TableColumn("[white bold]Repository[/]").LeftAligned());
        table.AddColumn(new TableColumn("[white bold]Branches[/]").Centered());
        table.AddColumn(new TableColumn("[white bold]Stale Branches[/]").Centered());
        table.AddColumn(new TableColumn("[white bold]Open PRs[/]").Centered());
        table.AddColumn(new TableColumn("[white bold]Stale PRs[/]").Centered());
        table.AddColumn(new TableColumn("[white bold]Draft PRs[/]").Centered());
        table.AddColumn(new TableColumn("[white bold]Health Status[/]").Centered());

        foreach (var res in results)
        {
            var statusText = "[green]Healthy[/]";
            if (res.StaleBranchesCount > 10 || res.StalePrsCount > 5)
            {
                statusText = "[red]Needs Cleanup[/]";
            }
            else if (res.StaleBranchesCount > 0 || res.StalePrsCount > 0)
            {
                statusText = "[yellow]Attention[/]";
            }

            var staleBranchesStr = res.StaleBranchesCount > 0
                ? $"[red bold]{res.StaleBranchesCount}[/]"
                : "[green]0[/]";

            var stalePrsStr = res.StalePrsCount > 0
                ? $"[yellow bold]{res.StalePrsCount}[/]"
                : "[green]0[/]";

            table.AddRow(
                $"[bold]{Markup.Escape(res.FullName)}[/]",
                res.TotalBranches.ToString(),
                staleBranchesStr,
                res.TotalOpenPrs.ToString(),
                stalePrsStr,
                res.DraftPrsCount.ToString(),
                statusText
            );
        }

        AnsiConsole.Write(table);
    }

    public static void PrintDetailedRepo(RepositoryHealthResult res)
    {
        AnsiConsole.WriteLine();
        AnsiConsole.MarkupLine("[bold blue]====================================================[/]");
        AnsiConsole.MarkupLine($"[bold blue]  Repository: [white underline]{Markup.Escape(res.FullName)}[/][/]");
        AnsiConsole.MarkupLine("[bold blue]====================================================[/]");

        // Stale Branches Section
        if (res.StaleBranches.Count == 0)
        {
            AnsiConsole.MarkupLine("[green]✔ No stale branches found![/]");
        }
        else
        {
            AnsiConsole.MarkupLine($"\n[yellow bold]🍂 Stale Branches ({res.StaleBranches.Count}):[/]");
            var branchTable = new Table().Border(TableBorder.Rounded);
            branchTable.AddColumn(new TableColumn("[white bold]Branch[/]").LeftAligned());
            branchTable.AddColumn(new TableColumn("[white bold]Days Inactive[/]").Centered());
            branchTable.AddColumn(new TableColumn("[white bold]Last Author[/]").LeftAligned());
            branchTable.AddColumn(new TableColumn("[white bold]Has Open PR?[/]").Centered());

            foreach (var b in res.StaleBranches.Take(15))
            {
                var inactiveStr = b.IsVeryStale
                    ? $"[red bold]{b.DaysInactive}d[/]"
                    : $"[yellow]{b.DaysInactive}d[/]";

                var hasPrStr = b.HasOpenPr ? "[green]Yes[/]" : "[grey]No[/]";

                branchTable.AddRow(
                    $"[magenta]{Markup.Escape(b.Name)}[/]",
                    inactiveStr,
                    Markup.Escape(b.Author),
                    hasPrStr
                );
            }

            AnsiConsole.Write(branchTable);
            if (res.StaleBranches.Count > 15)
            {
                AnsiConsole.MarkupLine($"[grey]...and {res.StaleBranches.Count - 15} more stale branches.[/]");
            }
        }

        // Open PRs Section
        if (res.PullRequests.Count == 0)
        {
            AnsiConsole.MarkupLine("\n[green]✔ No open pull requests.[/]");
        }
        else
        {
            AnsiConsole.MarkupLine($"\n[cyan bold]🔀 Open Pull Requests ({res.PullRequests.Count}):[/]");
            var prTable = new Table().Border(TableBorder.Rounded);
            prTable.AddColumn(new TableColumn("[white bold]#[/]").LeftAligned());
            prTable.AddColumn(new TableColumn("[white bold]Title[/]").LeftAligned());
            prTable.AddColumn(new TableColumn("[white bold]Author[/]").LeftAligned());
            prTable.AddColumn(new TableColumn("[white bold]Age[/]").Centered());
            prTable.AddColumn(new TableColumn("[white bold]Inactive[/]").Centered());
            prTable.AddColumn(new TableColumn("[white bold]Draft?[/]").Centered());

            foreach (var pr in res.PullRequests.Take(15))
            {
                var titleShort = pr.Title.Length > 40 ? pr.Title[..37] + "..." : pr.Title;
                var inactiveStr = pr.IsStalePr
                    ? $"[yellow]{pr.DaysSinceLastUpdate}d[/]"
                    : $"[green]{pr.DaysSinceLastUpdate}d[/]";
                var draftStr = pr.IsDraft ? "[grey]Draft[/]" : "[green]Ready[/]";

                prTable.AddRow(
                    $"[cyan]#{pr.Number}[/]",
                    Markup.Escape(titleShort),
                    Markup.Escape(pr.Author),
                    $"{pr.AgeDays}d",
                    inactiveStr,
                    draftStr
                );
            }

            AnsiConsole.Write(prTable);
            if (res.PullRequests.Count > 15)
            {
                AnsiConsole.MarkupLine($"[grey]...and {res.PullRequests.Count - 15} more pull requests.[/]");
            }
        }
    }

    public static void PrintUserOverviewTable(List<ContributorActivity> userActivities, bool allTime = false)
    {
        if (userActivities == null || userActivities.Count == 0) return;

        AnsiConsole.WriteLine();
        var titleMode = allTime ? "All-Time Records" : "Attention & Activity";
        AnsiConsole.MarkupLine($"[bold cyan]👤 Contributor Activities Overview ({titleMode})[/]");

        var table = new Table().Border(TableBorder.Rounded);
        if (allTime)
        {
            table.AddColumn(new TableColumn("[white bold]Contributor[/]").LeftAligned());
            table.AddColumn(new TableColumn("[white bold]Repos[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]All PRs[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Merged[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Open[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Branches[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Active[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Stale[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Merge Rate[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]To Review[/]").Centered());

            foreach (var u in userActivities.Take(20))
            {
                var staleBranchesStr = u.StaleBranchesCount > 0 ? $"[red]{u.StaleBranchesCount}[/]" : "[grey]0[/]";
                var rateStr = u.AcceptanceRate.HasValue ? $"{u.AcceptanceRate}%" : "[grey]—[/]";
                var attentionStr = u.TotalNeedsAttention > 0 ? $"[yellow bold]{u.TotalNeedsAttention}[/]" : "[green]0[/]";

                table.AddRow(
                    $"[bold]{Markup.Escape(u.Username)}[/]",
                    u.Repositories.Count.ToString(),
                    $"[cyan]{u.AllPrsCount}[/]",
                    $"[magenta]{u.MergedPrsCount}[/]",
                    $"[green]{u.OpenPrsCount}[/]",
                    u.AllBranchesCount.ToString(),
                    $"[green]{u.ActiveBranchesCount}[/]",
                    staleBranchesStr,
                    rateStr,
                    attentionStr
                );
            }
        }
        else
        {
            table.AddColumn(new TableColumn("[white bold]Contributor[/]").LeftAligned());
            table.AddColumn(new TableColumn("[white bold]Repos[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]All PRs[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Open PRs[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Stale PRs[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Stale Branches[/]").Centered());
            table.AddColumn(new TableColumn("[white bold]Items to Review[/]").Centered());

            foreach (var u in userActivities.Take(20))
            {
                var stalePrsStr = u.StalePrsCount > 0 ? $"[yellow]{u.StalePrsCount}[/]" : "[green]0[/]";
                var staleBranchesStr = u.StaleBranchesCount > 0 ? $"[red]{u.StaleBranchesCount}[/]" : "[green]0[/]";
                var attentionStr = u.TotalNeedsAttention > 0 ? $"[yellow bold]{u.TotalNeedsAttention}[/]" : "[green]0[/]";

                table.AddRow(
                    $"[bold]{Markup.Escape(u.Username)}[/]",
                    u.Repositories.Count.ToString(),
                    $"[cyan]{u.AllPrsCount}[/]",
                    u.OpenPrsCount.ToString(),
                    stalePrsStr,
                    staleBranchesStr,
                    attentionStr
                );
            }
        }

        AnsiConsole.Write(table);
        if (userActivities.Count > 20)
        {
            AnsiConsole.MarkupLine($"[grey]...and {userActivities.Count - 20} more contributors.[/]");
        }
    }
}
