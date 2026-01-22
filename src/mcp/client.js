"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClientManager = void 0;
const sdk_1 = require("@modelcontextprotocol/sdk");
const http_js_1 = require("@modelcontextprotocol/sdk/client/http.js");
const storage_1 = require("./storage");
class MCPClientManager {
    linearClient = null;
    githubClient = null;
    async connectLinear() {
        const token = await (0, storage_1.getToken)('linear');
        if (!token) {
            throw new Error('Linear token not found');
        }
        this.linearClient = new sdk_1.Client({
            name: 'swarmify-linear',
            version: '1.0.0'
        });
        const transport = new http_js_1.HttpServerTransport({
            url: 'https://mcp.linear.app/mcp',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        await this.linearClient.connect(transport);
        await this.linearClient.initialize();
    }
    async connectGitHub() {
        const token = await (0, storage_1.getToken)('github');
        if (!token) {
            throw new Error('GitHub token not found');
        }
        this.githubClient = new sdk_1.Client({
            name: 'swarmify-github',
            version: '1.0.0'
        });
        const transport = new http_js_1.HttpServerTransport({
            url: 'https://api.githubcopilot.com/mcp/',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        await this.githubClient.connect(transport);
        await this.githubClient.initialize();
    }
    async listLinearTools() {
        if (!this.linearClient)
            throw new Error('Linear client not connected');
        const result = await this.linearClient.listTools();
        return result.tools;
    }
    async callLinearTool(name, args) {
        if (!this.linearClient)
            throw new Error('Linear client not connected');
        const result = await this.linearClient.callTool({ name, arguments: args });
        return result.content;
    }
    async listGitHubTools() {
        if (!this.githubClient)
            throw new Error('GitHub client not connected');
        const result = await this.githubClient.listTools();
        return result.tools;
    }
    async callGitHubTool(name, args) {
        if (!this.githubClient)
            throw new Error('GitHub client not connected');
        const result = await this.githubClient.callTool({ name, arguments: args });
        return result.content;
    }
    async close() {
        await this.linearClient?.close();
        await this.githubClient?.close();
        this.linearClient = null;
        this.githubClient = null;
    }
}
exports.MCPClientManager = MCPClientManager;
//# sourceMappingURL=client.js.map