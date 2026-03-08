"use client";

type StepperProps = {
  steps: string[];
  currentStep: number;
};

export function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {steps.map((label, index) => {
        const active = index === currentStep;
        const complete = index < currentStep;
        return (
          <div
            key={label}
            className={`rounded border px-3 py-2 text-sm ${
              complete
                ? "border-green-200 bg-green-50 text-green-800"
                : active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"
            }`}
          >
            {index + 1}. {label}
          </div>
        );
      })}
    </div>
  );
}

