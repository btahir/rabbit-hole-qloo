"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
const variants = cva("button", {
  variants: {
    variant: { default: "button-primary", secondary: "button-secondary" },
  },
  defaultVariants: { variant: "secondary" },
});
export function Button({
  className,
  variant,
  children,
  ...props
}: BaseButton.Props & VariantProps<typeof variants>) {
  return (
    <BaseButton
      className={[variants({ variant }), className].filter(Boolean).join(" ")}
      {...props}
    >
      {props["aria-pressed"] ? <span aria-hidden="true">✓</span> : null}
      {children}
      {variant === "default" ? (
        <span className="button-arrow" aria-hidden="true">
          →
        </span>
      ) : null}
    </BaseButton>
  );
}
