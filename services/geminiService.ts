import { ComputeBundle } from "../types";
import { analyzeWithBackend, chatWithBackend } from "./astrologyService";

export const analyzeHoroscope = async (
  _birthDetails: any,
  computeBundle: ComputeBundle | any,
  question?: string
): Promise<string> => {
  const compute = (computeBundle?.compute) ? computeBundle.compute : computeBundle;
  return analyzeWithBackend(compute, question);
};

export const chatWithAstrologer = async (
  sessionId: string,
  message: string,
  computeBundle?: ComputeBundle | any,
  maxIterations: number = 3
): Promise<{ reply: string; used_charts?: string[]; trace?: string[]; refinement?: string }> => {
  const context = computeBundle?.compute || undefined;
  return chatWithBackend(sessionId, message, context, maxIterations);
};
