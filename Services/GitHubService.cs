using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FluffySniffle.Models;

namespace FluffySniffle.Services;

public class GitHubService
{
    private readonly HttpClient _httpClient;
    private readonly string? _token;
    private readonly bool _hasToken;

    public GitHubService(HttpClient httpClient)
    {
        _httpClient = httpClient;
        _token = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        _hasToken = !string.IsNullOrWhiteSpace(_token);

        _httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("fluffy-sniffle", "1.0"));
        if (_hasToken)
        {
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        }
    }

    public bool HasToken => _hasToken;

    public static (string Owner, string Repo) ParseRepoString(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
            throw new ArgumentException("Repository cannot be empty.");

        var str = input.Trim();
        str = Regex.Replace(str, @"^(https?:\/\/)?(www\.)?github\.com\/", "", RegexOptions.IgnoreCase);
        str = Regex.Replace(str, @"\.git$", "", RegexOptions.IgnoreCase);
        str = str.TrimEnd('/');

        if (str.StartsWith("topics/", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"\"{input}\" is a GitHub Topic category, not a repository. Please enter a valid repository (e.g. \"facebook/react\" or \"expressjs/express\").");
        }

        var parts = str.Split('/');
        if (parts.Length != 2 || string.IsNullOrWhiteSpace(parts[0]) || string.IsNullOrWhiteSpace(parts[1]))
        {
            throw new ArgumentException($"Invalid repository format \"{input}\". Expected \"owner/repo\" or \"https://github.com/owner/repo\".");
        }

        var owner = parts[0].Trim();
        var repo = parts[1].Trim();

        if (!Regex.IsMatch(owner, @"^[a-zA-Z0-9_.-]+$") || !Regex.IsMatch(repo, @"^[a-zA-Z0-9_.-]+$"))
        {
            throw new ArgumentException($"Repository name contains invalid characters: \"{owner}/{repo}\"");
        }

        return (owner, repo);
    }

    public async Task<RepositoryHealthResult> GetRepositoryHealthDataAsync(string owner, string repo)
    {
        var sw = Stopwatch.StartNew();
        var apiType = _hasToken ? "GraphQL API" : "REST API";
        AppLogger.Action("Fetch Repository", $"{owner}/{repo} using {apiType}");

        try
        {
            RepositoryHealthResult result;
            if (_hasToken)
            {
                result = await FetchViaGraphQLAsync(owner, repo);
            }
            else
            {
                result = await FetchViaRestAsync(owner, repo);
            }

            sw.Stop();
            AppLogger.Success($"Fetched repository {owner}/{repo} ({apiType}) in {sw.ElapsedMilliseconds}ms");
            return result;
        }
        catch (Exception ex)
        {
            sw.Stop();
            AppLogger.Error($"Failed to fetch repository {owner}/{repo} after {sw.ElapsedMilliseconds}ms: {ex.Message}");
            throw;
        }
    }

    private async Task<RepositoryHealthResult> FetchViaGraphQLAsync(string owner, string repo)
    {
        var sw = Stopwatch.StartNew();
        AppLogger.Info($"Fetching {owner}/{repo} via GitHub GraphQL API...");

        const string query = """
        query GetRepoHealth($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            name
            owner {
              login
            }
            isPrivate
            defaultBranchRef {
              name
            }
            refs(refPrefix: "refs/heads/", first: 100) {
              totalCount
              nodes {
                name
                target {
                  ... on Commit {
                    oid
                    committedDate
                    pushedDate
                    author {
                      name
                      user {
                        login
                      }
                    }
                  }
                }
              }
            }
            pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
              totalCount
              nodes {
                number
                title
                url
                state
                isDraft
                createdAt
                updatedAt
                closedAt
                mergedAt
                headRefName
                author {
                  login
                }
                comments {
                  totalCount
                }
              }
            }
            openPullRequests: pullRequests(states: OPEN) {
              totalCount
            }
          }
        }
        """;

        var requestBody = new
        {
            query,
            variables = new { owner, repo }
        };

        var jsonPayload = JsonSerializer.Serialize(requestBody);
        using var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync("https://api.github.com/graphql", content);
        var responseString = await response.Content.ReadAsStringAsync();
        sw.Stop();

        using var doc = JsonDocument.Parse(responseString);
        var root = doc.RootElement;

        if (root.TryGetProperty("errors", out var errorsElement))
        {
            var firstErr = errorsElement.EnumerateArray().FirstOrDefault();
            var message = firstErr.TryGetProperty("message", out var m) ? m.GetString() : "GraphQL error";
            throw new HttpRequestException($"GraphQL error for {owner}/{repo}: {message}");
        }

        if (!root.TryGetProperty("data", out var dataElement) ||
            !dataElement.TryGetProperty("repository", out var repoElement) ||
            repoElement.ValueKind == JsonValueKind.Null)
        {
            throw new HttpRequestException($"Repository {owner}/{repo} not found on GitHub.");
        }

        var defaultBranch = repoElement.TryGetProperty("defaultBranchRef", out var dbRef) && dbRef.ValueKind != JsonValueKind.Null && dbRef.TryGetProperty("name", out var dbName)
            ? dbName.GetString() ?? "main"
            : "main";

        var isPrivate = repoElement.TryGetProperty("isPrivate", out var ip) && ip.GetBoolean();

        var branches = new List<BranchInfo>();
        if (repoElement.TryGetProperty("refs", out var refsEl) && refsEl.TryGetProperty("nodes", out var refNodes))
        {
            foreach (var node in refNodes.EnumerateArray())
            {
                var name = node.GetProperty("name").GetString() ?? "";
                DateTimeOffset? commitDate = null;
                string? sha = null;
                var author = "unknown";

                if (node.TryGetProperty("target", out var target) && target.ValueKind == JsonValueKind.Object)
                {
                    if (target.TryGetProperty("oid", out var oid)) sha = oid.GetString();
                    if (target.TryGetProperty("committedDate", out var cd) && cd.TryGetDateTimeOffset(out var dto))
                    {
                        commitDate = dto;
                    }

                    if (target.TryGetProperty("author", out var authorEl))
                    {
                        if (authorEl.TryGetProperty("user", out var userEl) && userEl.ValueKind == JsonValueKind.Object && userEl.TryGetProperty("login", out var login))
                        {
                            author = login.GetString() ?? "unknown";
                        }
                        else if (authorEl.TryGetProperty("name", out var an))
                        {
                            author = an.GetString() ?? "unknown";
                        }
                    }
                }

                branches.Add(new BranchInfo
                {
                    Name = name,
                    LastCommitDate = commitDate,
                    LastCommitSha = sha,
                    Author = author,
                    RepoFullName = $"{owner}/{repo}"
                });
            }
        }

        var pullRequests = new List<PullRequestInfo>();
        if (repoElement.TryGetProperty("pullRequests", out var prsEl) && prsEl.TryGetProperty("nodes", out var prNodes))
        {
            foreach (var node in prNodes.EnumerateArray())
            {
                var number = node.GetProperty("number").GetInt32();
                var title = node.GetProperty("title").GetString() ?? "";
                var url = node.GetProperty("url").GetString() ?? "";
                var state = node.GetProperty("state").GetString() ?? "OPEN";
                var isDraft = node.TryGetProperty("isDraft", out var id) && id.GetBoolean();
                var createdAt = node.GetProperty("createdAt").GetDateTimeOffset();
                var updatedAt = node.GetProperty("updatedAt").GetDateTimeOffset();

                DateTimeOffset? closedAt = null;
                if (node.TryGetProperty("closedAt", out var ca) && ca.ValueKind != JsonValueKind.Null && ca.TryGetDateTimeOffset(out var caDto))
                    closedAt = caDto;

                DateTimeOffset? mergedAt = null;
                if (node.TryGetProperty("mergedAt", out var ma) && ma.ValueKind != JsonValueKind.Null && ma.TryGetDateTimeOffset(out var maDto))
                    mergedAt = maDto;

                var headRefName = node.TryGetProperty("headRefName", out var hrn) ? hrn.GetString() ?? "" : "";
                var author = "unknown";
                if (node.TryGetProperty("author", out var prAuth) && prAuth.ValueKind == JsonValueKind.Object && prAuth.TryGetProperty("login", out var authLogin))
                {
                    author = authLogin.GetString() ?? "unknown";
                }

                var commentsCount = 0;
                if (node.TryGetProperty("comments", out var comm) && comm.TryGetProperty("totalCount", out var tc))
                {
                    commentsCount = tc.GetInt32();
                }

                pullRequests.Add(new PullRequestInfo
                {
                    Number = number,
                    Title = title,
                    Url = url,
                    State = state,
                    IsDraft = isDraft,
                    CreatedAt = createdAt,
                    UpdatedAt = updatedAt,
                    ClosedAt = closedAt,
                    MergedAt = mergedAt,
                    HeadRefName = headRefName,
                    Author = author,
                    CommentsCount = commentsCount,
                    RepoFullName = $"{owner}/{repo}"
                });
            }
        }

        var openPrCount = pullRequests.Count(p => p.State == "OPEN");
        if (repoElement.TryGetProperty("openPullRequests", out var opr) && opr.TryGetProperty("totalCount", out var oprCount))
        {
            openPrCount = oprCount.GetInt32();
        }

        var totalBranchesCount = branches.Count;
        if (repoElement.TryGetProperty("refs", out var rf) && rf.TryGetProperty("totalCount", out var rfc))
        {
            totalBranchesCount = rfc.GetInt32();
        }

        var totalPrsCount = pullRequests.Count;
        if (repoElement.TryGetProperty("pullRequests", out var prTotal) && prTotal.TryGetProperty("totalCount", out var prtc))
        {
            totalPrsCount = prtc.GetInt32();
        }

        AppLogger.Info($"[{owner}/{repo}] GraphQL fetch complete in {sw.ElapsedMilliseconds}ms: {branches.Count} branches, {pullRequests.Count} PRs ({openPrCount} open, default branch: {defaultBranch})");

        return new RepositoryHealthResult
        {
            FullName = $"{owner}/{repo}",
            DefaultBranch = defaultBranch,
            IsPrivate = isPrivate,
            TotalBranches = totalBranchesCount,
            TotalOpenPrs = openPrCount,
            TotalPrs = totalPrsCount,
            AllBranches = branches,
            AllPullRequests = pullRequests,
            PullRequests = pullRequests.Where(p => p.State == "OPEN").ToList()
        };
    }

    private async Task<RepositoryHealthResult> FetchViaRestAsync(string owner, string repo)
    {
        var sw = Stopwatch.StartNew();
        AppLogger.Info($"Fetching {owner}/{repo} via GitHub REST API (unauthenticated fallback)...");

        // 1. Repo metadata
        var repoUrl = $"https://api.github.com/repos/{owner}/{repo}";
        var repoRes = await _httpClient.GetAsync(repoUrl);
        repoRes.EnsureSuccessStatusCode();
        using var repoDoc = JsonDocument.Parse(await repoRes.Content.ReadAsStringAsync());
        var defaultBranch = repoDoc.RootElement.GetProperty("default_branch").GetString() ?? "main";
        var isPrivate = repoDoc.RootElement.GetProperty("private").GetBoolean();

        // 2. PRs
        var prsUrl = $"https://api.github.com/repos/{owner}/{repo}/pulls?state=all&per_page=100";
        var prsRes = await _httpClient.GetAsync(prsUrl);
        prsRes.EnsureSuccessStatusCode();
        using var prsDoc = JsonDocument.Parse(await prsRes.Content.ReadAsStringAsync());

        var pullRequests = new List<PullRequestInfo>();
        foreach (var p in prsDoc.RootElement.EnumerateArray())
        {
            var number = p.GetProperty("number").GetInt32();
            var title = p.GetProperty("title").GetString() ?? "";
            var url = p.GetProperty("html_url").GetString() ?? "";
            var stateStr = p.GetProperty("state").GetString() ?? "open";
            var mergedAt = p.TryGetProperty("merged_at", out var ma) && ma.ValueKind != JsonValueKind.Null && ma.TryGetDateTimeOffset(out var maDto) ? (DateTimeOffset?)maDto : null;
            var closedAt = p.TryGetProperty("closed_at", out var ca) && ca.ValueKind != JsonValueKind.Null && ca.TryGetDateTimeOffset(out var caDto) ? (DateTimeOffset?)caDto : null;

            var state = "OPEN";
            if (mergedAt.HasValue) state = "MERGED";
            else if (stateStr.Equals("closed", StringComparison.OrdinalIgnoreCase)) state = "CLOSED";

            var isDraft = p.TryGetProperty("draft", out var dr) && dr.GetBoolean();
            var createdAt = p.GetProperty("created_at").GetDateTimeOffset();
            var updatedAt = p.GetProperty("updated_at").GetDateTimeOffset();

            var headRefName = p.TryGetProperty("head", out var headEl) && headEl.TryGetProperty("ref", out var hr) ? hr.GetString() ?? "" : "";
            var author = "unknown";
            if (p.TryGetProperty("user", out var userEl) && userEl.ValueKind == JsonValueKind.Object && userEl.TryGetProperty("login", out var ul))
            {
                author = ul.GetString() ?? "unknown";
            }

            var commentsCount = p.TryGetProperty("comments", out var comm) ? comm.GetInt32() : 0;

            pullRequests.Add(new PullRequestInfo
            {
                Number = number,
                Title = title,
                Url = url,
                State = state,
                IsDraft = isDraft,
                CreatedAt = createdAt,
                UpdatedAt = updatedAt,
                ClosedAt = closedAt,
                MergedAt = mergedAt,
                HeadRefName = headRefName,
                Author = author,
                CommentsCount = commentsCount,
                RepoFullName = $"{owner}/{repo}"
            });
        }

        // 3. Branches
        var branchesUrl = $"https://api.github.com/repos/{owner}/{repo}/branches?per_page=100";
        var branchesRes = await _httpClient.GetAsync(branchesUrl);
        branchesRes.EnsureSuccessStatusCode();
        using var branchesDoc = JsonDocument.Parse(await branchesRes.Content.ReadAsStringAsync());

        var branches = new List<BranchInfo>();
        var branchList = branchesDoc.RootElement.EnumerateArray().ToList();

        // Top 30 branches get commit details for last commit date
        var topBranches = branchList.Take(30).ToList();
        foreach (var b in topBranches)
        {
            var bName = b.GetProperty("name").GetString() ?? "";
            var commitSha = b.GetProperty("commit").GetProperty("sha").GetString();
            DateTimeOffset? commitDate = null;
            var author = "unknown";

            try
            {
                var commitUrl = $"https://api.github.com/repos/{owner}/{repo}/commits/{commitSha}";
                var commitRes = await _httpClient.GetAsync(commitUrl);
                if (commitRes.IsSuccessStatusCode)
                {
                    using var commitDoc = JsonDocument.Parse(await commitRes.Content.ReadAsStringAsync());
                    var commitObj = commitDoc.RootElement.GetProperty("commit");
                    if (commitObj.TryGetProperty("committer", out var committer) && committer.TryGetProperty("date", out var cdate))
                    {
                        if (cdate.TryGetDateTimeOffset(out var cdto)) commitDate = cdto;
                    }

                    if (commitDoc.RootElement.TryGetProperty("author", out var authObj) && authObj.ValueKind == JsonValueKind.Object && authObj.TryGetProperty("login", out var cAuthLogin))
                    {
                        author = cAuthLogin.GetString() ?? "unknown";
                    }
                }
            }
            catch
            {
                // Graceful fallback
            }

            branches.Add(new BranchInfo
            {
                Name = bName,
                LastCommitDate = commitDate,
                LastCommitSha = commitSha,
                Author = author,
                RepoFullName = $"{owner}/{repo}"
            });
        }

        sw.Stop();
        var openPrs = pullRequests.Count(p => p.State == "OPEN");
        AppLogger.Info($"[{owner}/{repo}] REST fetch complete in {sw.ElapsedMilliseconds}ms: {branches.Count} branches, {pullRequests.Count} PRs ({openPrs} open, default branch: {defaultBranch})");

        return new RepositoryHealthResult
        {
            FullName = $"{owner}/{repo}",
            DefaultBranch = defaultBranch,
            IsPrivate = isPrivate,
            TotalBranches = branchList.Count,
            TotalOpenPrs = openPrs,
            TotalPrs = pullRequests.Count,
            AllBranches = branches,
            AllPullRequests = pullRequests,
            PullRequests = pullRequests.Where(p => p.State == "OPEN").ToList()
        };
    }
}
