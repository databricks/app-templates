import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@databricks/appkit-ui/react';
import { useEffect, useId, useRef, useState } from 'react';

import type { AppParameter } from '../../shared/appManifest';

export function ComboboxParameterControl({
  parameter,
  value,
  onValueChange,
}: {
  parameter: AppParameter;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const label = parameter.label === '' ? parameter.name : parameter.label;
  const choices = [...new Set(parameter.choices ?? [])];
  const suggestions = filtering
    ? choices.filter((choice) => choice.toLowerCase().includes(value.toLowerCase()))
    : choices;
  const activeId = open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => {
    if (activeId !== undefined) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };
  const select = (choice: string) => {
    onValueChange(choice);
    close();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActiveIndex(-1);
      }}
    >
      <PopoverAnchor asChild>
        <InputGroup ref={anchorRef}>
          <InputGroupInput
            ref={inputRef}
            id={parameter.name}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onFocus={() => {
              setFiltering(false);
              setOpen(true);
            }}
            onBlur={close}
            onChange={(event) => {
              onValueChange(event.target.value);
              setFiltering(true);
              setActiveIndex(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) setFiltering(false);
                setOpen(true);
                const count = open ? suggestions.length : choices.length;
                if (count === 0) return;
                setActiveIndex((current) =>
                  !open || current < 0
                    ? event.key === 'ArrowDown'
                      ? 0
                      : count - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count,
                );
              } else if (event.key === 'Enter') {
                if (open && activeIndex >= 0 && suggestions[activeIndex] !== undefined) {
                  event.preventDefault();
                  select(suggestions[activeIndex]);
                } else {
                  close();
                }
              } else if (event.key === 'Escape') {
                close();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={`Show suggestions for ${label}`}
              aria-expanded={open}
              tabIndex={-1}
              size="icon-xs"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                inputRef.current?.focus();
                setFiltering(false);
                setActiveIndex(-1);
                setOpen(!open);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        align="start"
        className="max-h-[min(15rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        {suggestions.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-sm">No matching suggestions</p>
        ) : (
          suggestions.map((choice, index) => (
            <div
              key={choice}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className="aria-selected:bg-accent aria-selected:text-accent-foreground cursor-default rounded-sm px-2 py-1.5 text-sm wrap-anywhere"
              onPointerMove={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => select(choice)}
            >
              {choice}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
