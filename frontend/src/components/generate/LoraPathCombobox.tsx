import { PathCombobox } from "./PathCombobox";

interface LoraPathComboboxProps {
  value: string;
  loraRoot: string;
  loraFiles: string[];
  onChange: (path: string) => void;
  placeholder?: string;
}

export function LoraPathCombobox({ value, loraRoot, loraFiles, onChange, placeholder }: LoraPathComboboxProps) {
  return (
    <PathCombobox
      value={value}
      root={loraRoot}
      files={loraFiles}
      onChange={onChange}
      placeholder={placeholder}
      noFilesPlaceholder="No LoRA root configured"
    />
  );
}
