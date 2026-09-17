"use client";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ru } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateLabel } from "@/lib/deadlines";

const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const minuteSteps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59];
const pad = (value: number) => String(value).padStart(2, "0");

function shiftDays(from: Date, days: number) {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}

/** Дата — в календаре, время — двумя списками. Значение всегда локальное. */
export function DateTimePicker({
  value,
  onChange,
  busyDates = [],
}: {
  value: Date;
  onChange: (value: Date) => void;
  busyDates?: Date[];
}) {
  const [open, setOpen] = useState(false);

  function withDate(date: Date) {
    const next = new Date(date);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(next);
  }
  function withTime(hour: number, minute: number) {
    const next = new Date(value);
    next.setHours(hour, minute, 0, 0);
    onChange(next);
  }

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-12 min-w-0 flex-1 justify-start gap-2 px-4 text-base font-normal"
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{dateLabel(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <div className="flex gap-2">
            {[
              ["Сегодня", 0],
              ["Завтра", 1],
              ["Через неделю", 7],
            ].map(([label, days]) => (
              <Button
                key={String(label)}
                type="button"
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  withDate(shiftDays(new Date(), Number(days)));
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="single"
            required
            locale={ru}
            weekStartsOn={1}
            selected={value}
            defaultMonth={value}
            modifiers={{ busy: busyDates }}
            modifiersClassNames={{
              busy: "after:absolute after:bottom-1.5 after:size-1 after:rounded-full after:bg-primary data-[selected-single=true]:after:bg-primary-foreground",
            }}
            onSelect={(date) => {
              if (!date) return;
              withDate(date);
              setOpen(false);
            }}
            className="p-0"
          />
        </PopoverContent>
      </Popover>
      <TimeFields
        hour={value.getHours()}
        minute={value.getMinutes()}
        onChange={withTime}
      />
    </div>
  );
}

/** Часы и минуты двумя списками. Минуты — шаг 5 плюс 59 и любое своё значение. */
export function TimeFields({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  const minutes = minuteSteps.includes(minute)
    ? minuteSteps
    : [...minuteSteps, minute].sort((a, b) => a - b);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value={pad(hour)}
        onValueChange={(next) => onChange(Number(next), minute)}
      >
        <SelectTrigger
          aria-label="Часы"
          className="h-12 w-16 justify-center px-2 text-base"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="min-w-0">
          {hours.map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select
        value={pad(minute)}
        onValueChange={(next) => onChange(hour, Number(next))}
      >
        <SelectTrigger
          aria-label="Минуты"
          className="h-12 w-16 justify-center px-2 text-base"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="min-w-0">
          {minutes.map((value) => (
            <SelectItem key={value} value={pad(value)}>
              {pad(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
