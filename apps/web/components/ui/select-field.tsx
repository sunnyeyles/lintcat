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

type SelectFieldProps = {
  id: string;
  name: string;
  label: string;
  options: readonly Option[];
  defaultValue?: string;
  placeholder: string;
  triggerClassName: string;
};

export function SelectField({ id, label, options, placeholder, triggerClassName, ...select }: SelectFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select {...select}>
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
