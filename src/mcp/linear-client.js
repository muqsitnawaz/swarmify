"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinearMCPClient = void 0;
class LinearMCPClient {
    manager;
    constructor(manager) {
        this.manager = manager;
    }
    async fetchAssignedIssues() {
        try {
            const result = await this.manager.callLinearTool('list_issues', {
                filter: {
                    assignee: { isMe: { eq: true } },
                    state: {
                        type: {
                            nin: ['completed', 'canceled']
                        }
                    }
                }
            });
            const issues = result?.issues || result?.nodes || [];
            return this.parseLinearIssues(issues);
        }
        catch (err) {
            console.error('[LINEAR MCP] Error fetching issues:', err);
            return [];
        }
    }
    parseLinearIssues(response) {
        const issues = response?.issues || response?.nodes || [];
        return issues.map((issue) => ({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            state: issue.state.name,
            stateType: issue.state.type,
            priority: issue.priority,
            url: issue.url,
            labels: issue.labels?.nodes?.map((n) => n.name) || [],
            assignee: issue.assignee?.name
        }));
    }
}
exports.LinearMCPClient = LinearMCPClient;
//# sourceMappingURL=linear-client.js.map