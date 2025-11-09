export default class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new tool instance with Spotlight.
   * The tool must expose a `getMetadata()` function that returns an object with at least:
   *  - name: string
   *  - description: string
   *  - parameters: array of parameter descriptors
   *  - returns: array of return value descriptors
   */
  register(toolInstance) {
    if (!toolInstance || typeof toolInstance.getMetadata !== 'function') {
      throw new Error('Tool must implement getMetadata().');
    }

    const metadata = toolInstance.getMetadata();

    if (!metadata?.name) {
      throw new Error('Tool metadata must include a unique `name` field.');
    }

    if (this.tools.has(metadata.name)) {
      throw new Error(`A tool named "${metadata.name}" is already registered.`);
    }

    this.tools.set(metadata.name, {
      instance: toolInstance,
      metadata: Object.freeze({ ...metadata }),
    });
  }

  getTool(name) {
    return this.tools.get(name);
  }

  listTools() {
    return Array.from(this.tools.values()).map(({ metadata }) => metadata);
  }

  /**
   * Executes the named tool with the provided parameter payload.
   * @param {string} name
   * @param {object} params
   * @param {object} context - Optional context to pass down to the tool
   */
  async execute(name, params = {}, context = {}) {
    const entry = this.getTool(name);
    if (!entry) {
      throw new Error(`No tool registered under the name "${name}".`);
    }

    const tool = entry.instance;

    if (typeof tool.execute !== 'function') {
      throw new Error(`Tool "${name}" does not implement execute().`);
    }

    return tool.execute(params, context);
  }

  /**
   * Requests a tool-specific interpretation of the query, enabling the tool
   * to score the query for relevance and extract structured parameters.
   * Returns an array sorted by descending confidence score.
   * @param {string} query
   */
  scoreQueryAgainstTools(query) {
    const results = [];

    for (const { metadata, instance } of this.tools.values()) {
      if (typeof instance.canHandle !== 'function') continue;

      try {
        const match = instance.canHandle(query, metadata);
        if (match && typeof match.score === 'number' && match.score > 0) {
          results.push({
            toolName: metadata.name,
            score: match.score,
            params: match.params ?? {},
            reasoning: match.reasoning,
          });
        }
      } catch (error) {
        console.warn(`Failed to run canHandle for tool "${metadata.name}":`, error);
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
