import { collapseCarriageReturns } from "@bb/text-utils";

const ESCAPE_SEQUENCE =
  /\u001b(?:\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)|[P^_X][^\u001b]*(?:\u001b\\|$)|\[([0-?]*)([ -/]*)([@-~])|[ -/]*[0-~]|)/g;
const SGR_PARAMETERS = /^[0-9:;]*$/;
const STRIPPED_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g;

function keepSgrOnly(
  sequence: string,
  parameters: string | undefined,
  intermediates: string | undefined,
  final: string | undefined,
): string {
  if (
    final === "m" &&
    intermediates === "" &&
    parameters !== undefined &&
    SGR_PARAMETERS.test(parameters)
  ) {
    return sequence;
  }
  return "";
}

export function sanitizeBackgroundOutput(text: string): string {
  return collapseCarriageReturns(
    text.replace(ESCAPE_SEQUENCE, keepSgrOnly),
  ).replace(STRIPPED_CONTROL_CHARACTERS, "");
}
