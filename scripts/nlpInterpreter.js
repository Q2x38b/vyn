export default class NLPInterpreter {
  constructor(toolRegistry) {
    this.registry = toolRegistry;
  }

  /**
   * Returns the structured context describing all available tools.
   * This is the contract that the NLP system uses to understand capabilities.
   */
  getContextPayload() {
    return {
      generatedAt: new Date().toISOString(),
      tools: this.registry.listTools(),
    };
  }

  /**
   * Interprets the user query and tries to select the best matching tool along with parameters.
   * @param {string} query
   */
  interpret(query) {
    const normalized = query?.trim();
    if (!normalized) {
      return {
        success: false,
        message: 'Please enter a request.',
        candidates: [],
      };
    }

    const scoredCandidates = this.registry.scoreQueryAgainstTools(normalized);

    if (scoredCandidates.length === 0) {
      return {
        success: false,
        message: 'No tool recognized this request.',
        candidates: [],
      };
    }

    const topCandidate = scoredCandidates[0];
    const confidenceThreshold = 0.35;

    if (topCandidate.score < confidenceThreshold) {
      return {
        success: false,
        message: 'Unable to confidently determine a tool for this request.',
        candidates: scoredCandidates,
      };
    }

    return {
      success: true,
      toolName: topCandidate.toolName,
      params: topCandidate.params,
      reasoning: topCandidate.reasoning,
      candidates: scoredCandidates,
    };
  }
}
