import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  Univer,
  LocaleType,
  UniverInstanceType,
} from '@univerjs/core';
import { defaultTheme } from '@univerjs/presets';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import {
  validateGridCaps,
  validateGridFormulas,
  validateSingleFormula,
  detectUnsupportedContent,
  type GridExportTemplateDefinition,
  type GridSheetDefinition,
} from '@config-platform/schema';
import { gridTemplateToUniver, univerToGridTemplate } from '../src/studio/export-grid/univer-adapter';
import { GridTemplateDesigner } from '../src/studio/GridTemplateDesigner';
import { AppBarProvider, STATUS_MESSAGE_DURATION_MS, useStatusNotify } from '../src/context/app-bar-context';

// The designer uses React Query (its Share button and shared layouts), as it does inside the app
const render = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // A wrapper (not wrapping the element) so rerender keeps the provider
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
};

// Mock API client
vi.mock('../src/api/client', () => ({
  getExportTemplate: vi.fn().mockImplementation((id: string) =>
    Promise.resolve({
      id,
      name: 'Test Budget Template',
      entityId: 'ent_1',
      version: 1,
      draft: {
        kind: 'grid',
        version: 1,
        schemaVersion: 2,
        parameters: [],
        datasets: [],
        filenameExpression: '"budget"',
        pdf: { mode: 'table' },
        sheets: [
          {
            id: 'sheet_1',
            name: 'Sheet 1',
            order: 0,
            merges: [],
            cells: {
              '0:0': { value: 'Budget Header' },
            },
            regions: [],
            conditionalFormats: [],
          },
        ],
      },
    })
  ),
  updateExportTemplate: vi.fn().mockResolvedValue({ id: 'tpl_1', name: 'Updated' }),
  publishExportTemplate: vi.fn().mockResolvedValue({ id: 'tpl_1', version: 2 }),
  downloadExportTemplateRenderPreview: vi.fn().mockResolvedValue(new Blob(['mock_xlsx'], { type: 'application/vnd.openxmlformats' })),
}));

// Mock Theme context
vi.mock('../src/context/theme-context', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    setTheme: vi.fn(),
    workspaceTheme: {},
    setWorkspaceTheme: vi.fn(),
    themeEditing: 'locked',
    refetchWorkspaceTheme: vi.fn(),
  }),
}));

vi.mock('@univerjs/ui', async (importOriginal) => {
  const actual = await importOriginal<any>();
  class MockUniverUIPlugin {
    static pluginName = 'UNIVER_UI_PLUGIN';
    static type = 0;
    getPluginName() {
      return 'UNIVER_UI_PLUGIN';
    }
    onStarting() {}
    onReady() {}
    onRendered() {}
    onSteady() {}
  }
  return {
    ...actual,
    UniverUIPlugin: MockUniverUIPlugin,
  };
});

describe('Phase 2A: Grid Template Designer Frontend Suite', () => {
  it('keeps the status bar in place (empty) so a message appearing never moves the page', () => {
    render(
      <MemoryRouter>
        <AppBarProvider>
          <div>Page content</div>
        </AppBarProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Page content')).toBeInTheDocument();
    expect(screen.getByTestId('app-bottom-bar')).toBeEmptyDOMElement();
  });

  it('notify shows action feedback in the status bar and clears it after a while', async () => {
    vi.useFakeTimers();
    try {
      function Saver() {
        const notify = useStatusNotify();
        return (
          <>
            <button onClick={() => notify('success', 'Theme saved')}>save</button>
            <button onClick={() => notify('error', 'Save failed: offline')}>fail</button>
          </>
        );
      }
      render(<AppBarProvider><Saver /></AppBarProvider>);

      fireEvent.click(screen.getByText('save'));
      const message = screen.getByTestId('app-status-notification');
      expect(message).toHaveTextContent('Theme saved');
      expect(message).toHaveClass('app-statusbar-message-success');
      act(() => { vi.advanceTimersByTime(STATUS_MESSAGE_DURATION_MS.success + 10); });
      expect(screen.queryByTestId('app-status-notification')).toBeNull();

      // Errors stay longer and are announced assertively
      fireEvent.click(screen.getByText('fail'));
      act(() => { vi.advanceTimersByTime(STATUS_MESSAGE_DURATION_MS.success + 10); });
      expect(screen.getByTestId('app-status-notification')).toHaveAttribute('aria-live', 'assertive');
      act(() => { vi.advanceTimersByTime(STATUS_MESSAGE_DURATION_MS.error); });
      expect(screen.queryByTestId('app-status-notification')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a message opens from zero to its own width, filled in its type colour with a matching icon', async () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(180);
    try {
      function Saver() {
        const notify = useStatusNotify();
        return <button onClick={() => notify('error', 'Delete failed')}>fail</button>;
      }
      render(<AppBarProvider><Saver /></AppBarProvider>);
      fireEvent.click(screen.getByText('fail'));

      const message = screen.getByTestId('app-status-notification');
      // Starts closed, then opens to the measured content width (CSS transitions the change)
      expect(message.style.width).toBe('0px');
      await waitFor(() => expect(message.style.width).toBe('180px'));
      expect(message).toHaveClass('app-statusbar-message-error');
      expect(message.querySelector('svg.app-statusbar-message-icon')).not.toBeNull();
    } finally {
      widthSpy.mockRestore();
    }
  });

  it('a component outside the app shell can call notify safely (no-op)', () => {
    function Saver() {
      const notify = useStatusNotify();
      return <button onClick={() => notify('success', 'x')}>save</button>;
    }
    render(<Saver />);
    expect(() => fireEvent.click(screen.getByText('save'))).not.toThrow();
  });

  // ─── 1. Zero Foreign Network Requests ──────────────────────────────────────

  describe('Zero Outbound Foreign Origin Network Requests', () => {
    let foreignRequests: string[] = [];
    const origFetch = window.fetch;
    const origXHR = window.XMLHttpRequest;
    const origImage = window.Image;

    beforeEach(() => {
      foreignRequests = [];

      // Spy on fetch
      window.fetch = vi.fn().mockImplementation((urlOrReq: any, ...args: any[]) => {
        const urlStr = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq?.url || '';
        if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
          const parsed = new URL(urlStr);
          if (parsed.origin !== window.location.origin) {
            foreignRequests.push(`fetch: ${urlStr}`);
          }
        }
        return origFetch ? origFetch(urlOrReq, ...args) : Promise.resolve(new Response('{}'));
      });

      // Spy on XMLHttpRequest
      const mockXHR = function (this: XMLHttpRequest) {
        const real = new origXHR();
        const origOpen = real.open;
        real.open = function (method: string, url: string | URL, ...rest: any[]) {
          const urlStr = String(url);
          if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
            const parsed = new URL(urlStr);
            if (parsed.origin !== window.location.origin) {
              foreignRequests.push(`xhr: ${urlStr}`);
            }
          }
          return (origOpen as any).apply(this, [method, url, ...rest]);
        };
        return real;
      };
      window.XMLHttpRequest = mockXHR as any;

      // Spy on Image constructor
      window.Image = class extends origImage {
        set src(val: string) {
          if (val.startsWith('http://') || val.startsWith('https://')) {
            const parsed = new URL(val);
            if (parsed.origin !== window.location.origin) {
              foreignRequests.push(`image: ${val}`);
            }
          }
          super.src = val;
        }
      };
    });

    afterEach(() => {
      window.fetch = origFetch;
      window.XMLHttpRequest = origXHR;
      window.Image = origImage;
    });

    it('opening the designer issues zero requests to foreign origins', async () => {
      render(
        <MemoryRouter initialEntries={['/studio/export-templates/tpl_1/designer']}>
          <Routes>
            <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Test Budget Template')).toBeInTheDocument();
      });

      // Verify no foreign network requests were fired
      expect(foreignRequests).toEqual([]);
    });
  });

  it('offers multiple starter layouts and applies the selected template', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_1/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Budget Template')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Starter Templates' }));
    expect(screen.getByRole('dialog', { name: 'Choose a starter layout' })).toBeInTheDocument();
    expect(screen.getByText('Executive Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Operations Board')).toBeInTheDocument();
    expect(screen.getByText('Financial Overview')).toBeInTheDocument();
    expect(screen.getByText('Audit Register')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Operations Board starter template' }));
    await waitFor(() => {
      expect(screen.getByText('Applied Operations Board template')).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers the interactive Production Target Tracker starter and loads its charts', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_1/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Budget Template')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Starter Templates' }));
    expect(screen.getByText('Production Target Tracker')).toBeInTheDocument();
    expect(screen.getByText('Interactive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Production Target Tracker starter template' }));
    await waitFor(() => {
      expect(screen.getByText('Applied Production Target Tracker template')).toBeInTheDocument();
    });
    // The four range charts render as overlay cards
    for (const id of ['chart_production_daily_pct', 'chart_production_overall', 'chart_production_per_day', 'chart_production_progress']) {
      expect(await screen.findByTestId(`chart-overlay-${id}`)).toBeInTheDocument();
    }
  });

  it('shows publish confirmation in the designer status bar', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_1/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Budget Template')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const statusBar = screen.getByTestId('notification-toast');
    await waitFor(() => {
      expect(statusBar).toHaveTextContent('Published grid template successfully');
    });
    expect(statusBar.closest('footer')).toBeInTheDocument();
  });

  it('shows designer context and publish feedback in the shared app bar', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_1/designer']}>
        <AppBarProvider>
          <Routes>
            <Route
              path="/studio/export-templates/:id/designer"
              element={<GridTemplateDesigner />}
            />
          </Routes>
        </AppBarProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Budget Template')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-bottom-bar')).toHaveTextContent('A1');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(screen.getByTestId('app-status-notification')).toHaveTextContent(
        'Published grid template successfully'
      );
    });
    expect(screen.queryByTestId('notification-toast')).not.toBeInTheDocument();
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });

  // ─── 2. Programmatic Editing in Real Univer Instance ───────────────────────

  describe('Real Univer Instance Programmatic Editing & Round-Trip Mapping', () => {
    it('applies merge, border, fill, and number format programmatically and asserts stored JSON', () => {
      const univer = new Univer({
        theme: defaultTheme,
        locale: LocaleType.EN_US,
      });
      univer.registerPlugin(UniverRenderEnginePlugin);
      univer.registerPlugin(UniverFormulaEnginePlugin);
      univer.registerPlugin(UniverSheetsPlugin);

      // Create a unit with initial cell
      const initialSheet: GridSheetDefinition = {
        id: 's_test',
        name: 'Report',
        order: 0,
        merges: [],
        cells: {
          '0:0': { value: 1250 },
        },
        regions: [],
        conditionalFormats: [],
      };

      const initialTemplate: GridExportTemplateDefinition = {
        kind: 'grid',
        version: 1,
        schemaVersion: 2,
        parameters: [],
        datasets: [],
        sheets: [initialSheet],
        filenameExpression: '"sales_report"',
        pdf: { mode: 'table' },
      };

      const univerData = gridTemplateToUniver(initialTemplate);
      const workbook = univer.createUnit(UniverInstanceType.UNIVER_SHEET, univerData);

      // Programmatically modify the sheet snapshot:
      // Apply merge A1:B2 (rows 0..1, cols 0..1)
      const snap: any = workbook.getSnapshot();
      snap.sheets.s_test.mergeData = [
        { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
      ];

      // Apply fill (#CBD5E1), border (top & bottom thin), font bold, and currency numFmt ($#,##0.00)
      const cellData = snap.sheets.s_test.cellData;
      if (!cellData[0]) cellData[0] = {};
      cellData[0][0] = {
        v: 1250,
        s: {
          bg: { rgb: '#CBD5E1' },
          cl: { rgb: '#0F172A' },
          bl: 1,
          bd: {
            t: { s: 1, style: 'thin', cl: { rgb: '#94A3B8' } },
            b: { s: 1, style: 'thin', cl: { rgb: '#94A3B8' } },
          },
          n: { pattern: '$#,##0.00' },
        },
      };

      // Convert back to kind: "grid" template schema
      const storedJson = univerToGridTemplate(snap);

      // Assert merges
      expect(storedJson.sheets[0].merges).toBeDefined();
      expect(storedJson.sheets[0].merges?.length).toBe(1);
      expect(storedJson.sheets[0].merges![0]).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });

      // Assert cell fill, border, numFmt, value
      const targetCell = storedJson.sheets[0].cells['0:0'];
      expect(targetCell).toBeDefined();
      expect(targetCell.value).toBe(1250);
      expect(targetCell.numFmt).toBe('$#,##0.00');
      expect(targetCell.style?.fill?.fgColor).toBe('#CBD5E1');
      expect(targetCell.style?.font?.bold).toBe(true);
      expect(targetCell.style?.font?.color).toBe('#0F172A');
      expect(targetCell.style?.border?.top?.style).toBe('thin');
      expect(targetCell.style?.border?.bottom?.style).toBe('thin');

      // ─── 3. Load stored JSON and assert editor state ─────────────────────────
      const reloadedUniverData = gridTemplateToUniver(storedJson);
      expect(reloadedUniverData.sheets.s_test.mergeData).toHaveLength(1);
      expect(reloadedUniverData.sheets.s_test.cellData[0][0].v).toBe(1250);
      expect(reloadedUniverData.sheets.s_test.cellData[0][0].s.bg.rgb).toBe('#CBD5E1');
      expect(reloadedUniverData.sheets.s_test.cellData[0][0].s.n.pattern).toBe('$#,##0.00');

      univer.dispose();
    });
  });

  // ─── 4. Unsupported-Content Detection ──────────────────────────────────────

  describe('Unsupported Content Detection & Warning', () => {
    it('detects unsupported features (charts, images, comments, data validation, pivots, protection)', () => {
      const snapshotWithUnsupported = {
        sheets: {
          s1: {
            id: 's1',
            charts: [{ id: 'chart_1' }],
            drawings: [{ id: 'img_1' }],
            comments: [{ id: 'comment_1' }],
            dataValidation: [{ id: 'rule_1' }],
            pivotTable: { id: 'piv_1' },
            protection: { id: 'prot_1' },
          },
        },
      };

      const warnings = detectUnsupportedContent(snapshotWithUnsupported);
      expect(warnings).toContain('Charts');
      expect(warnings).toContain('Images / Drawings');
      expect(warnings).toContain('Comments');
      expect(warnings).toContain('Data Validation');
      expect(warnings).toContain('Pivot Tables');
      expect(warnings).toContain('Sheet Protection');
    });

    it('returns empty array when content is clean static layout', () => {
      const cleanSnapshot = {
        sheets: {
          s1: {
            id: 's1',
            name: 'Clean Sheet',
            cellData: { 0: { 0: { v: 'Hello' } } },
            mergeData: [],
          },
        },
      };
      const warnings = detectUnsupportedContent(cleanSnapshot);
      expect(warnings).toEqual([]);
    });
  });

  // ─── 5. Formula Validation Allowlist & Rejection ────────────────────────────

  describe('Formula Allowlist & Rejection Rules', () => {
    it('accepts allowed functions: SUM, AVERAGE, COUNT, COUNTA, MIN, MAX, IF, ROUND, ABS, SUBTOTAL and arithmetic', () => {
      const allowedFormulas = [
        '=SUM(A1:A10)',
        '=AVERAGE(B1:B5)',
        '=COUNT(C1:C20)',
        '=COUNTA(D1:D10)',
        '=MIN(E1:E5)',
        '=MAX(F1:F5)',
        '=IF(A1 > 0, ROUND(B1 * 1.1, 2), ABS(A1))',
        '=SUBTOTAL(9, G1:G100)',
        '=A1 + B1 * (C1 - D1) / 2',
        '=HYPERLINK("https://example.com", "Example Link")',
      ];

      for (const f of allowedFormulas) {
        const check = validateSingleFormula(f);
        expect(check.valid).toBe(true);
      }
    });

    it('rejects external workbook references', () => {
      const res = validateSingleFormula('=[external_workbook.xlsx]Sheet1!A1 + 5');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/External workbook references are not allowed/i);
    });

    it('rejects DDE strings', () => {
      const res1 = validateSingleFormula('=cmd|"/c calc"!A0');
      expect(res1.valid).toBe(false);
      expect(res1.error).toMatch(/DDE/i);

      const res2 = validateSingleFormula('="abc" | \'calc\'');
      expect(res2.valid).toBe(false);
      expect(res2.error).toMatch(/DDE/i);
    });

    it('rejects WEBSERVICE, FILTERXML, INDIRECT, and OFFSET', () => {
      expect(validateSingleFormula('=WEBSERVICE("http://evil.com")').valid).toBe(false);
      expect(validateSingleFormula('=FILTERXML("<xml></xml>", "//a")').valid).toBe(false);
      expect(validateSingleFormula('=INDIRECT("A" & 1)').valid).toBe(false);
      expect(validateSingleFormula('=OFFSET(A1, 1, 1)').valid).toBe(false);
    });

    it('rejects HYPERLINK to non-http(s) schemes like javascript:, file:, data:', () => {
      const res = validateSingleFormula('=HYPERLINK("file:///etc/passwd", "Click")');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/HYPERLINK function only allows http:\/\/, https:\/\//i);
    });

    it('rejects unallowed function names (e.g. VLOOKUP, INDEX, MATCH)', () => {
      const res = validateSingleFormula('=VLOOKUP(10, A1:B10, 2, FALSE)');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/unsupported function "VLOOKUP"/i);
    });
  });

  // ─── 6. Caps Enforcement ───────────────────────────────────────────────────

  describe('Caps Enforcement', () => {
    it('enforces sheets cap (<= 10)', () => {
      const template = {
        sheets: Array.from({ length: 11 }, (_, i) => ({
          id: `s_${i}`,
          cells: {},
        })),
      };
      const check = validateGridCaps(template);
      expect(check.valid).toBe(false);
      expect(check.errors[0]).toMatch(/maximum limit of 10 sheets/i);
    });

    it('enforces stored non-empty cells cap (<= 20,000)', () => {
      const cells: Record<string, any> = {};
      for (let i = 0; i < 20_001; i++) {
        cells[`${i}:0`] = { value: 1 };
      }
      const template = {
        sheets: [{ id: 's1', cells }],
      };
      const check = validateGridCaps(template);
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes('20,000 non-empty cells'))).toBe(true);
    });

    it('enforces 2 MB JSON byte length cap', () => {
      const bigString = 'X'.repeat(2 * 1024 * 1024 + 10);
      const template = {
        sheets: [
          {
            id: 's1',
            cells: { '0:0': { value: bigString } },
          },
        ],
      };
      const check = validateGridCaps(template);
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes('exceeds maximum limit of 2 MB'))).toBe(true);
    });
  });
});
