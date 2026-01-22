"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubMCPClient = void 0;
class GitHubMCPClient {
    manager;
    constructor(manager) {
        this.manager = manager;
    }
    async fetchMyIssues() {
        try {
            const result = await this.manager.callGitHubTool('list_issues', {
                state: 'open',
                assignee: '@me'
            });
            const issues = result?.issues || result?.items || [];
            return this.parseGitHubIssues(issues);
        }
        catch (err) {
            console.error('[GITHUB MCP] Error fetching issues:', err);
            return [];
        }
    }
    parseGitHubIssues(issues) {
        return issues.map((issue) => ({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            url: issue.html_url,
            labels: issue.labels?.map((l) => l.name) || [],
            assignee: issue.assignee?.login
        }));
    }
}
exports.GitHubMCPClient = GitHubMCPClient;
//# sourceMappingURL=github-client.js.map