import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui-style button; large touch targets (min 48 px) for phones. */
const buttonVariants = cva(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-slate-900 text-white hover:bg-slate-800',
        accent: 'bg-amber-400 text-slate-950 hover:bg-amber-300',
        outline: 'border-2 border-slate-300 bg-white text-slate-900 hover:bg-slate-100',
        ghost: 'text-slate-700 hover:bg-slate-100',
        danger: 'text-red-700 hover:bg-red-50',
      },
      size: {
        default: '',
        lg: 'min-h-14 text-lg',
        icon: 'h-12 w-12 px-0',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  block,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}
