import { Button } from "@bb/shared-ui/button";

interface HandoffChangeTargetButtonProps {
  disabled: boolean;
  onClick: () => void;
}

export function HandoffChangeTargetButton({
  disabled,
  onClick,
}: HandoffChangeTargetButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="ml-auto h-6 shrink-0 px-2 text-xs text-subtle-foreground"
      onClick={onClick}
      disabled={disabled}
    >
      Change project or environment
    </Button>
  );
}
