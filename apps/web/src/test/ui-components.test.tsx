import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  Button,
  ChartCard,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Pagination,
  PermissionDenied,
  StatusBadge,
  Switch,
  Checkbox,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
  type Column,
} from '@salesos/ui';

describe('Button', () => {
  it('blocks clicks and announces busy state while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
  it('fires onClick normally and is not a submit button by default', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('FormField', () => {
  it('associates label, hint and error with the control', () => {
    render(
      <FormField label="Email" hint="Work address" error="Enter a valid email" required>
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/email/i);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });
  it('has no axe violations', async () => {
    const { container } = render(
      <form>
        <FormField label="Name">
          <Input />
        </FormField>
        <Checkbox label="Agree" />
        <Switch label="Reminders" />
      </form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('StatusBadge', () => {
  it('always renders text with an icon, never colour alone', () => {
    const { container } = render(<StatusBadge status="overdue">Overdue</StatusBadge>);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

interface Row {
  id: string;
  name: string;
  stage: string;
}
const rows: Row[] = [
  { id: '1', name: 'Alpha', stage: 'New' },
  { id: '2', name: 'Beta', stage: 'Won' },
];
const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (r) => r.name },
  { id: 'stage', header: 'Stage', cell: (r) => r.stage },
];

describe('DataTable', () => {
  it('renders a semantic table (desktop) and a card list (mobile) from the same rows', () => {
    render(<DataTable caption="Leads" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    const table = screen.getByRole('table', { name: 'Leads' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Stage']);
    expect(screen.getByRole('list', { name: 'Leads' }).querySelectorAll('li')).toHaveLength(2);
  });
  it('shows loading, empty and error states', async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <DataTable caption="L" columns={columns} rows={undefined} loading getRowId={(r) => r.id} />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    rerender(
      <DataTable
        caption="L"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        emptyTitle="Nothing"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Nothing' })).toBeInTheDocument();
    rerender(
      <DataTable
        caption="L"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        error={{ message: 'Boom', onRetry: retry }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
  it('exposes sort state via aria-sort', async () => {
    const onSort = vi.fn();
    render(
      <DataTable
        caption="L"
        columns={[{ ...columns[0]!, sortable: true }, columns[1]!]}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ columnId: 'name', direction: 'asc' }}
        onSortChange={onSort}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSort).toHaveBeenCalledWith({ columnId: 'name', direction: 'desc' });
  });
});

describe('Combobox', () => {
  function Harness() {
    const [v, setV] = React.useState<string | null>(null);
    return (
      <FormField label="Owner">
        <Combobox
          value={v}
          onValueChange={setV}
          options={[
            { value: 'a', label: 'Asha' },
            { value: 'b', label: 'Bharat' },
          ]}
        />
      </FormField>
    );
  }
  it('filters, navigates with the keyboard and selects', async () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: /owner/i });
    await userEvent.click(box);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.type(box, 'bh');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Bharat');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('shows an empty message when nothing matches', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('disables Previous on page 1 and Next when no more pages; calls handler', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} hasNext onPageChange={onPage} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
  it('disables Next at the last known page', () => {
    render(<Pagination page={3} pageCount={3} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
  });
});

describe('state panels', () => {
  it('ErrorState and PermissionDenied announce as alerts; EmptyState is a heading', () => {
    const { container } = render(
      <>
        <ErrorState requestId="abc" />
        <PermissionDenied />
        <EmptyState title="Empty" />
      </>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText('abc')).toBeInTheDocument();
    return axe(container).then((r) => expect(r).toHaveNoViolations());
  });
});

describe('ChartCard', () => {
  it('always has a text summary and can switch to an accessible table', async () => {
    render(
      <ChartCard
        title="Calls"
        summary="Calls rose from 10 to 20."
        data={[
          { m: 'Jan', v: 10 },
          { m: 'Feb', v: 20 },
        ]}
        xKey="m"
        series={[{ key: 'v', label: 'Calls' }]}
      />,
    );
    expect(screen.getByText('Calls rose from 10 to 20.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /table/i }));
    const table = screen.getByRole('table', { name: 'Calls' });
    expect(within(table).getByRole('rowheader', { name: 'Feb' })).toBeInTheDocument();
    expect(within(table).getByText('20')).toBeInTheDocument();
  });
});

describe('Tabs and Timeline', () => {
  it('Tabs expose tab roles and switch panels', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="t">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('Panel B')).toBeInTheDocument();
  });
  it('Timeline is an ordered list with time elements', () => {
    render(
      <Timeline
        label="Activity"
        items={[{ id: '1', title: 'Called', time: '2 min ago', dateTime: '2026-10-14T10:00:00Z' }]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Activity' });
    expect(list.tagName).toBe('OL');
    expect(within(list).getByText('2 min ago').tagName).toBe('TIME');
  });
});
