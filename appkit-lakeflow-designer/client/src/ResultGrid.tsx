import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useMemo } from 'react';

import { categorize, formatCell, isNumericCategory, TypeGlyph } from './dataTypes';
import type { OkPayload, SchemaField } from './payload';
import { ResultFooter } from './ResultFooter';
import { createResultColumns, createResultFilter } from './resultTable';

const MIN_COLUMN_WIDTH = 110;
const MAX_INITIAL_COLUMN_WIDTH = 300;
const MIN_RESIZED_COLUMN_WIDTH = 80;
const MAX_RESIZED_COLUMN_WIDTH = 1000;
const COLUMN_RESIZE_STEP = 10;

const BODY_CHAR_WIDTH = 6.6;

const HEADER_CHAR_WIDTH = 7.3;
const CELL_PADDING = 16;

const HEADER_GLYPH = 40;

const WIDTH_SAMPLE_ROWS = 100;

function measureColumnWidth(field: SchemaField, rows: OkPayload['rows']): number {
  const category = categorize(field.type);
  let widestBody = 0;
  for (let i = 0; i < Math.min(rows.length, WIDTH_SAMPLE_ROWS); i += 1) {
    const { text } = formatCell(rows[i]?.[field.name], category);
    widestBody = Math.max(widestBody, (text ?? 'null').length);
  }
  const headerWidth = field.name.length * HEADER_CHAR_WIDTH + HEADER_GLYPH + CELL_PADDING;
  const bodyWidth = widestBody * BODY_CHAR_WIDTH + CELL_PADDING;
  const raw = Math.max(headerWidth, bodyWidth);
  return Math.round(Math.min(Math.max(raw, MIN_COLUMN_WIDTH), MAX_INITIAL_COLUMN_WIDTH));
}

function NullBadge() {
  return (
    <code className="bg-muted text-muted-foreground border-border rounded-[3px] border px-[0.4em] py-0 text-[85%]">
      null
    </code>
  );
}

export function ResultGrid({ payload }: { payload: OkPayload }) {
  return <InteractiveResultGrid key={JSON.stringify(payload.schema)} payload={payload} />;
}

function InteractiveResultGrid({ payload }: { payload: OkPayload }) {
  const { schema, rows } = payload;
  const filter = useMemo(() => createResultFilter(schema), [schema]);
  const columns = useMemo(() => createResultColumns(schema).map((column, index) => ({
    ...column,
    size: measureColumnWidth(schema[index], rows),
  })), [schema, rows]);
  const table = useReactTable({
    data: rows,
    columns,
    columnResizeMode: 'onChange',
    defaultColumn: { minSize: MIN_RESIZED_COLUMN_WIDTH, maxSize: MAX_RESIZED_COLUMN_WIDTH },
    globalFilterFn: filter,
    getColumnCanGlobalFilter: () => true,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const globalFilter = table.getState().globalFilter ?? '';
  const visibleColumns = table.getVisibleLeafColumns();
  const tableRows = table.getRowModel().rows;
  const rowNumberWidth = Math.max(44, String(rows.length).length * BODY_CHAR_WIDTH + 24);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Input
          type="search"
          aria-label="Search returned rows"
          placeholder="Search returned rows…"
          className="h-8 min-w-0 max-w-sm flex-1 text-xs"
          value={globalFilter}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={schema.length === 0}>
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            {table.getAllLeafColumns().map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                disabled={column.getIsVisible() && visibleColumns.length === 1}
                onCheckedChange={(visible) => column.toggleVisibility(visible)}
                onSelect={(event) => event.preventDefault()}
              >
                {schema[Number(column.id)].name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {payload.truncated === true && (
        <p className="text-muted-foreground px-3 pb-2 text-xs">
          This preview is truncated. Sorting and filtering apply to the returned rows.
        </p>
      )}
      {/* AppKit's inner wrapper must own scrolling so sticky headers track the visible viewport. */}
      <div className="border-border border-t [&>[data-slot=table-container]]:max-h-[60vh] [&>[data-slot=table-container]]:overflow-auto">
        <Table
          className="table-fixed border-separate border-spacing-0 text-xs"
          style={{ width: rowNumberWidth + table.getTotalSize(), minWidth: '100%' }}
        >
          <colgroup>
            <col style={{ width: rowNumberWidth }} />
            {visibleColumns.map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
            <col />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="bg-card text-muted-foreground border-border sticky top-0 z-20 h-[30px] border-r border-b p-0 px-2 text-right align-middle font-normal"
                aria-label="Row number"
              />
              {table.getFlatHeaders().map((header) => {
                const column = header.column;
                const field = schema[Number(column.id)];
                const category = categorize(field.type);
                const sorted = column.getIsSorted();
                return (
                  <TableHead
                    key={column.id}
                    title={`${field.name} · ${field.type}${field.nullable ? '' : ' · not null'}`}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                    className="bg-card text-foreground border-border sticky top-0 z-10 h-[30px] border-r border-b px-2 py-0 align-middle font-bold whitespace-nowrap"
                  >
                    <Button
                      variant="ghost"
                      aria-label={`Sort by ${field.name}`}
                      className="h-auto w-full justify-start gap-1.5 overflow-hidden p-0 text-xs font-bold"
                      onClick={column.getToggleSortingHandler()}
                    >
                      <span className="text-muted-foreground flex shrink-0 items-center">
                        <TypeGlyph category={category} />
                      </span>
                      <span className="truncate">{field.name}</span>
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="text-muted-foreground ml-auto size-3.5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path
                          d={sorted === 'asc'
                            ? 'M12 19V5m-5 5 5-5 5 5'
                            : sorted === 'desc'
                              ? 'M12 5v14m-5-5 5 5 5-5'
                              : 'M8 20V4m-4 4 4-4 4 4M16 4v16m-4-4 4 4 4-4'}
                        />
                      </svg>
                    </Button>
                    <div
                      role="separator"
                      aria-label={`Resize ${field.name} column`}
                      aria-orientation="vertical"
                      aria-valuemin={MIN_RESIZED_COLUMN_WIDTH}
                      aria-valuemax={MAX_RESIZED_COLUMN_WIDTH}
                      aria-valuenow={column.getSize()}
                      aria-valuetext={`${column.getSize()} pixels wide`}
                      tabIndex={0}
                      title="Drag or use Left/Right arrows to resize. Double-click or press Enter to reset."
                      className={[
                        'absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize touch-none select-none',
                        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                        column.getIsResizing() ? 'bg-accent' : '',
                      ].join(' ')}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() => column.resetSize()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          column.resetSize();
                          return;
                        }
                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                        event.preventDefault();
                        const size = column.getSize() + (event.key === 'ArrowLeft' ? -COLUMN_RESIZE_STEP : COLUMN_RESIZE_STEP);
                        table.setColumnSizing((current) => ({
                          ...current,
                          [column.id]: size,
                        }));
                      }}
                    />
                  </TableHead>
                );
              })}
              <TableHead className="bg-card sticky top-0 z-10 h-[30px] p-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 2} className="text-muted-foreground py-6 text-center">
                  {rows.length === 0 ? 'No rows returned.' : 'No matching rows.'}
                </TableCell>
              </TableRow>
            )}
            {tableRows.map((row) => (
              <TableRow key={row.id} className="hover:bg-transparent">
                <TableCell className="text-muted-foreground border-border h-[25px] border-r border-b px-2 py-1 text-right align-middle tabular-nums">
                  {row.index + 1}
                </TableCell>
                {row.getVisibleCells().map((cell) => {
                  const field = schema[Number(cell.column.id)];
                  const category = categorize(field.type);
                  const { text, title } = formatCell(cell.getValue(), category);
                  return (
                    <TableCell
                      key={cell.id}
                      title={text === null ? undefined : title}
                      className={[
                        'border-border text-foreground h-[25px] overflow-hidden border-r border-b px-2 py-1 align-middle',
                        'text-ellipsis whitespace-pre',
                        isNumericCategory(category) ? 'tabular-nums' : '',
                      ].join(' ')}
                    >
                      {text === null ? <NullBadge /> : text}
                    </TableCell>
                  );
                })}
                <TableCell className="h-[25px] p-0" />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ResultFooter
        payload={payload}
        matchingRowCount={globalFilter.trim() === '' ? undefined : tableRows.length}
      />
    </div>
  );
}
