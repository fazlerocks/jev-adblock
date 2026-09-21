export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { yes?: string; no?: string };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface SystemOneRequest {
  model: string;
  state: JsonValue;
  questions: Record<string, Question>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence: number;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface ModelCard {
  name: string;
  description: string;
  release_date: string;
}
