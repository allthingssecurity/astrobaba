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
  computeBundle?: ComputeBundle | any
): Promise<string> => {
  const context = computeBundle?.compute || undefined;
  return chatWithBackend(sessionId, message, context);
};
