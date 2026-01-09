/**
 * Normalizes a pattern to a string representation
 * Handles string patterns and object patterns (converts to JSON)
 *
 * @param pattern - Pattern to normalize (string or object)
 * @returns String representation of the pattern
 */
export function normalizePattern(pattern: any): string {
  if (typeof pattern === 'string') {
    return pattern;
  }

  if (typeof pattern === 'object' && pattern !== null) {
    // Sort keys for consistent serialization
    return JSON.stringify(sortObjectKeys(pattern));
  }

  return String(pattern);
}

/**
 * Sorts object keys recursively for consistent serialization
 */
function sortObjectKeys(obj: Record<string, any>): Record<string, any> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return obj;
  }

  return Object.keys(obj)
    .sort()
    .reduce(
      (sorted, key) => {
        sorted[key] = sortObjectKeys(obj[key]);
        return sorted;
      },
      {} as Record<string, any>,
    );
}

/**
 * Parses a pattern string back to its original form
 * Tries to parse as JSON, falls back to string
 *
 * @param patternString - String representation of the pattern
 * @returns Original pattern (string or object)
 */
export function parsePattern(patternString: string): any {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(patternString);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Not JSON, return as string
  }
  return patternString;
}

/**
 * Checks if two patterns match
 *
 * @param pattern1 - First pattern
 * @param pattern2 - Second pattern
 * @returns True if patterns match
 */
export function patternsMatch(pattern1: any, pattern2: any): boolean {
  const normalized1 = normalizePattern(pattern1);
  const normalized2 = normalizePattern(pattern2);
  return normalized1 === normalized2;
}

/**
 * Creates a unique identifier for a subscription
 *
 * @param topic - Topic name
 * @param subscription - Subscription name
 * @param isDeadLetter - Whether this is a dead letter queue
 * @returns Unique identifier string
 */
export function createSubscriptionKey(
  topic: string,
  subscription: string,
  isDeadLetter = false,
): string {
  return `${topic}/${subscription}${isDeadLetter ? '/$deadletter' : ''}`;
}
