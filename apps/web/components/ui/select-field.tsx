import {
  cn,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pr-review/design";

import type { Option } from "@/lib/forms";

export type SelectFieldProps = {
  id: string;
  name: string;
  label: string;
  options: readonly Option[];
  defaultValue?: string;
  placeholder?: string;
  triggerClassName?: string;
};

export function SelectField({
  id,
  name,
  label,
  options,
  defaultValue,
  placeholder,
  triggerClassName,
}: SelectFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select name={name} defaultValue={defaultValue}>
        <SelectTrigger id={id} className={cn("w-full", triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
