import { create, all } from "mathjs";

const math = create(all);

/**
 * Evaluates mathematical expressions safely.
 * Replaces the logic found in your original calculator.py.
 */
export const calculate = (expression: string): string => {
  try {
    const result = math.evaluate(expression);
    return `Result: ${result}`;
  } catch (error) {
    return "Error: I couldn't evaluate that mathematical expression. Please ensure it is formatted correctly.";
  }
};
