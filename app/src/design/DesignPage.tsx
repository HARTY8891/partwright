import { useState, type ReactNode } from 'react';
import {
  Axis3D, Box, Circle, CircleDot, Copy, Eye, FlipHorizontal2, Grid3X3, Layers, Maximize, Minus,
  PenLine, RectangleHorizontal, Ruler, Scissors, Spline, Square, SquareDashed, Undo2, Rotate3D,
  Scale3D, Cylinder, Hexagon,
} from 'lucide-react';
import tokens from '../../../replica/design/tokens.json';
import { Button, IconButton } from '../ui/Button';
import { Ribbon, RibbonButton, RibbonDivider, RibbonSplitButton, RibbonTabPanel, RibbonTabs } from '../ui/Ribbon';
import { RollbackBar, Tree, TreeItem } from '../ui/Tree';
import { Checkbox, NumberField, Select, SelectionBox } from '../ui/Fields';
import { ConfirmCorner, DimensionEditor, FeaturePanel, MessageBanner, PanelSection } from '../ui/Panel';
import { IssueRow, Modal, StatusBar, ToastProvider, Tooltip, TooltipProvider, useToast } from '../ui/Overlay';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-8 py-12 border-b border-border">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-6">{children}</div>;
const Label = ({ children }: { children: ReactNode }) => <div className="text-2xs uppercase tracking-wide text-text-muted font-semibold">{children}</div>;

export function DesignPage() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <Content />
      </ToastProvider>
    </TooltipProvider>
  );
}

function Content() {
  const toast = useToast();
  const [tab, setTab] = useState('Features');
  const [sel, setSel] = useState('Extrude1');
  const [expanded, setExpanded] = useState(true);
  const [rollback, setRollback] = useState(6);
  const [end, setEnd] = useState<'blind' | 'through' | 'mid'>('blind');
  const [dir2, setDir2] = useState(false);
  const [merge, setMerge] = useState(true);
  const [edges, setEdges] = useState(['Edge <1>', 'Edge <2>', 'Edge <3>']);
  const [modal, setModal] = useState(false);
  const [tool, setTool] = useState('line');

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-10 flex items-center gap-8 h-24 px-12 bg-surface-raised border-b border-border">
        <Box size={20} className="text-accent" aria-hidden />
        <h1 className="text-lg font-semibold">Partwright design system</h1>
        <nav className="flex gap-6 text-xs text-text-muted">
          {['colours', 'type', 'buttons', 'ribbon', 'tree', 'fields', 'panels', 'overlays', 'workspace'].map((s) => (
            <a key={s} href={`#${s}`} className="hover:text-text">
              {s}
            </a>
          ))}
        </nav>
      </header>

      <main className="max-w-[1200px] mx-auto px-12">
        <Section id="colours" title="Colour roles">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
            {Object.entries(tokens.color).map(([k, v]) => (
              <div key={k} className="rounded-md border border-border overflow-hidden">
                <div className="h-24" style={{ background: v }} />
                <div className="px-4 py-3">
                  <div className="text-xs font-medium">{k}</div>
                  <div className="text-2xs font-mono text-text-muted">{v}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="type" title="Type scale">
          {Object.entries(tokens.type).map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-8">
              <span className="w-40 text-2xs font-mono text-text-muted">
                {k} {v.size}/{v.line}/{v.weight}
              </span>
              <span style={{ fontSize: v.size, lineHeight: `${v.line}px`, fontWeight: v.weight }}>
                Extrude the sketch 20 mm from the front plane
              </span>
            </div>
          ))}
          <div className="font-mono text-sm">Mono: D1@Sketch1 = width / 2 → 25.000 mm</div>
        </Section>

        <Section id="buttons" title="Buttons">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
            <Row key={v}>
              <span className="w-40 text-xs text-text-muted">{v}</span>
              <Button variant={v} size="sm">Small</Button>
              <Button variant={v}>Medium</Button>
              <Button variant={v} size="lg">Large</Button>
              <Button variant={v} disabled>Disabled</Button>
              <Button variant={v} loading>Saving</Button>
            </Row>
          ))}
          <Row>
            <span className="w-40 text-xs text-text-muted">icon</span>
            <IconButton label="Undo"><Undo2 size={16} /></IconButton>
            <IconButton label="Show planes" pressed><Layers size={16} /></IconButton>
            <IconButton label="Zoom to fit" size="sm"><Maximize size={14} /></IconButton>
            <IconButton label="Disabled" disabled><Copy size={16} /></IconButton>
          </Row>
        </Section>

        <Section id="ribbon" title="Command ribbon">
          <div className="border border-border rounded-md overflow-hidden">
            <RibbonTabs tabs={['Features', 'Sketch', 'Evaluate']} value={tab} onValueChange={setTab}>
              <RibbonTabPanel value="Features">
                <Ribbon label="Feature commands">
                  <RibbonSplitButton
                    main={{ icon: <Box size={24} />, label: 'Extrude', shortcut: 'E' }}
                    items={[{ label: 'Extrude' }, { label: 'Extrude thin' }]}
                  />
                  <RibbonButton icon={<Rotate3D size={24} />} label="Revolve" />
                  <RibbonDivider />
                  <RibbonButton icon={<Scissors size={24} />} label="Cut" />
                  <RibbonButton icon={<Cylinder size={24} />} label="Cut revolve" />
                  <RibbonDivider />
                  <RibbonButton icon={<CircleDot size={24} />} label="Fillet" active />
                  <RibbonButton icon={<Hexagon size={24} />} label="Chamfer" />
                  <RibbonButton icon={<SquareDashed size={24} />} label="Shell" disabled />
                  <RibbonDivider />
                  <div className="flex flex-col justify-center">
                    <RibbonButton layout="small" icon={<Grid3X3 size={16} />} label="Linear pattern" />
                    <RibbonButton layout="small" icon={<FlipHorizontal2 size={16} />} label="Mirror" />
                  </div>
                </Ribbon>
              </RibbonTabPanel>
              <RibbonTabPanel value="Sketch">
                <Ribbon label="Sketch tools">
                  {[
                    ['line', <Minus size={24} />, 'Line'],
                    ['rect', <RectangleHorizontal size={24} />, 'Rectangle'],
                    ['circle', <Circle size={24} />, 'Circle'],
                    ['spline', <Spline size={24} />, 'Spline'],
                    ['dim', <Ruler size={24} />, 'Dimension'],
                  ].map(([id, icon, label]) => (
                    <RibbonButton key={id as string} icon={icon} label={label as string} active={tool === id} onClick={() => setTool(id as string)} />
                  ))}
                </Ribbon>
              </RibbonTabPanel>
              <RibbonTabPanel value="Evaluate">
                <Ribbon label="Evaluate tools">
                  <RibbonButton icon={<Ruler size={24} />} label="Measure" />
                  <RibbonButton icon={<Scale3D size={24} />} label="Mass" />
                </Ribbon>
              </RibbonTabPanel>
            </RibbonTabs>
          </div>
        </Section>

        <Section id="tree" title="Feature tree">
          <div className="w-140 border border-border rounded-md bg-surface-raised">
            <Tree label="Feature tree">
              <TreeItem icon={<Axis3D size={16} />} label="Origin" />
              <TreeItem icon={<Square size={16} />} label="Front plane" />
              <TreeItem icon={<Square size={16} />} label="Top plane" />
              <TreeItem icon={<PenLine size={16} />} label="Sketch1" />
              <TreeItem
                icon={<Box size={16} />}
                label="Extrude1"
                selected={sel === 'Extrude1'}
                expanded={expanded}
                onToggle={() => setExpanded(!expanded)}
                onSelect={() => setSel('Extrude1')}
                onRename={(n) => toast('info', `Renamed to ${n}`)}
              />
              {expanded && <TreeItem icon={<PenLine size={16} />} label="Sketch2" level={2} selected={sel === 'Sketch2'} onSelect={() => setSel('Sketch2')} />}
              <TreeItem icon={<CircleDot size={16} />} label="Fillet1" status="warning" message="Some edges were skipped" onSelect={() => setSel('Fillet1')} selected={sel === 'Fillet1'} />
              <TreeItem icon={<Scissors size={16} />} label="Cut1" status="error" message="Sketch plane is missing" onSelect={() => setSel('Cut1')} selected={sel === 'Cut1'} />
              <TreeItem icon={<Hexagon size={16} />} label="Chamfer1 (suppressed)" suppressed />
              <RollbackBar index={rollback} max={9} onChange={setRollback} />
              <TreeItem icon={<SquareDashed size={16} />} label="Shell1" rolledBack />
            </Tree>
          </div>
          <p className="text-xs text-text-muted">
            Keyboard: Enter/Space select, F2 rename (or double-click), ←/→ collapse/expand, Tab to the rollback bar, then ↑/↓.
          </p>
        </Section>

        <Section id="fields" title="Fields">
          <div className="grid grid-cols-3 gap-10 max-w-[900px]">
            <NumberField label="Depth" value="20" min={0} />
            <NumberField label="Depth (expression)" value="=width/2" vars={{ width: 50 }} />
            <NumberField label="Depth (invalid)" value="abc" />
            <NumberField label="Angle" value="90" unit="°" />
            <NumberField label="Count" value="4" unit="" min={1} />
            <NumberField label="Disabled" value="5" disabled />
            <Select
              label="End condition"
              value={end}
              onChange={setEnd}
              options={[
                { value: 'blind', label: 'Fixed depth' },
                { value: 'through', label: 'Through everything' },
                { value: 'mid', label: 'Symmetric' },
              ]}
            />
            <SelectionBox label="Edges" prompt="Pick edges in the view" items={edges} focused onRemove={(i) => setEdges(edges.filter((_, j) => j !== i))} />
            <SelectionBox label="Faces to remove" prompt="Pick faces in the view" items={[]} error="Pick at least one face" />
            <div className="flex flex-col gap-4">
              <Checkbox label="Merge with body" checked={merge} onChange={setMerge} />
              <Checkbox label="Disabled option" checked={false} onChange={() => {}} disabled />
            </div>
          </div>
        </Section>

        <Section id="panels" title="Feature panel, banners, confirm corner, dimension editor">
          <div className="flex flex-wrap gap-12 items-start">
            <div className="w-140">
              <FeaturePanel icon={<Box size={18} />} title="Extrude" onConfirm={() => toast('success', 'Extrude1 created')} onCancel={() => toast('info', 'Cancelled')}>
                <MessageBanner tone="info">Pick a closed sketch, then set the depth.</MessageBanner>
                <PanelSection title="Direction 1">
                  <Select
                    label="End condition"
                    value={end}
                    onChange={setEnd}
                    options={[
                      { value: 'blind', label: 'Fixed depth' },
                      { value: 'through', label: 'Through everything' },
                      { value: 'mid', label: 'Symmetric' },
                    ]}
                  />
                  {end !== 'through' && <NumberField label="Depth" value="20" min={0} />}
                </PanelSection>
                <PanelSection title="Direction 2" toggle={{ checked: dir2, onChange: setDir2 }}>
                  <NumberField label="Depth" value="10" min={0} />
                </PanelSection>
                <PanelSection title="Options">
                  <Checkbox label="Merge with body" checked={merge} onChange={setMerge} />
                </PanelSection>
              </FeaturePanel>
            </div>
            <div className="w-140">
              <FeaturePanel icon={<CircleDot size={18} />} title="Fillet" canConfirm={false}>
                <MessageBanner tone="error">Radius is too large for Edge &lt;2&gt;.</MessageBanner>
                <PanelSection title="Edges">
                  <SelectionBox label="Edges" prompt="Pick edges" items={['Edge <1>', 'Edge <2>']} />
                  <NumberField label="Radius" value="12" min={0} />
                </PanelSection>
              </FeaturePanel>
            </div>
            <div className="flex flex-col gap-8">
              <Label>Confirm corner</Label>
              <ConfirmCorner mode="sketch" />
              <ConfirmCorner mode="feature" canConfirm={false} />
              <Label>Dimension editor</Label>
              <DimensionEditor name="D1@Sketch1" value="40" />
              <DimensionEditor name="D3@Sketch1" value="15" overDefines />
              <MessageBanner tone="warning">Fillet1 skipped 1 edge.</MessageBanner>
            </div>
          </div>
        </Section>

        <Section id="overlays" title="Modal, tooltip, toast, status bar">
          <Row>
            <Button variant="primary" onClick={() => setModal(true)}>Open “What went wrong”</Button>
            <Tooltip label="Extrude" shortcut="E" hint="Turn a closed sketch into a solid">
              <Button>Hover or focus me</Button>
            </Tooltip>
            <Button onClick={() => toast('success', 'Part saved')}>Success toast</Button>
            <Button onClick={() => toast('error', 'Export failed: no solid body')}>Error toast</Button>
          </Row>
          <Modal
            open={modal}
            onOpenChange={setModal}
            title="What went wrong"
            footer={<Button variant="primary" onClick={() => setModal(false)}>Close</Button>}
          >
            <IssueRow kind="error" feature="Cut1" message="Its sketch plane no longer exists. Pick a new face or plane." />
            <IssueRow kind="warning" feature="Fillet1" message="1 of 4 edges could not be filleted and was skipped." />
          </Modal>
          <div className="flex flex-col gap-4 border border-border rounded-md overflow-hidden">
            <StatusBar hint="Click to start the line" sketchState="under" dof={3} units="mm" rebuild={{ state: 'busy' }} />
            <StatusBar sketchState="full" units="mm" rebuild={{ state: 'idle', ms: 42 }} />
            <StatusBar sketchState="over" units="in" rebuild={{ state: 'errors', errors: 2 }} />
          </div>
        </Section>

        <Section id="workspace" title="Workspace layout (static mock of S03 / S05)">
          <Workspace />
        </Section>
      </main>
    </div>
  );
}

/** Static composition: ribbon + tree + viewport with sketch colours + status bar. */
function Workspace() {
  const c = tokens.color;
  return (
    <div className="flex flex-col h-[560px] border border-border rounded-md overflow-hidden">
      <div className="flex items-center h-14 px-4 gap-6 bg-surface-raised border-b border-border text-xs">
        <Box size={14} className="text-accent" aria-hidden />
        {['File', 'Edit', 'View', 'Insert', 'Tools', 'Help'].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <Ribbon label="Sketch tools">
        <RibbonButton icon={<Minus size={24} />} label="Line" active />
        <RibbonButton icon={<RectangleHorizontal size={24} />} label="Rectangle" />
        <RibbonButton icon={<Circle size={24} />} label="Circle" />
        <RibbonDivider />
        <RibbonButton icon={<Ruler size={24} />} label="Dimension" />
      </Ribbon>
      <div className="flex flex-1 min-h-0">
        <aside className="w-140 bg-surface-raised border-r border-border overflow-auto">
          <Tree label="Feature tree">
            <TreeItem icon={<Axis3D size={16} />} label="Origin" />
            <TreeItem icon={<Square size={16} />} label="Front plane" selected />
            <TreeItem icon={<Square size={16} />} label="Top plane" />
            <TreeItem icon={<Square size={16} />} label="Right plane" />
            <TreeItem icon={<PenLine size={16} />} label="Sketch1 (editing)" />
          </Tree>
        </aside>
        <div className="relative flex-1" style={{ background: `linear-gradient(${c['viewport-top']}, ${c['viewport-bottom']})` }}>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-1 p-1 rounded-lg bg-surface-raised/90 shadow-card">
            <IconButton size="sm" label="Zoom to fit"><Maximize size={14} /></IconButton>
            <IconButton size="sm" label="Views"><Box size={14} /></IconButton>
            <IconButton size="sm" label="Show planes" pressed><Layers size={14} /></IconButton>
            <IconButton size="sm" label="Display style"><Eye size={14} /></IconButton>
          </div>
          <div className="absolute top-4 right-4">
            <ConfirmCorner mode="sketch" />
          </div>
          <svg viewBox="0 0 600 340" className="absolute inset-0 w-full h-full" role="img" aria-label="Sketch preview showing defined, under-defined and over-defined lines">
            <rect x="80" y="50" width="440" height="240" fill={c['plane-fill']} fillOpacity=".15" stroke={c['plane-fill']} strokeOpacity=".6" />
            <line x1="150" y1="250" x2="420" y2="250" stroke={c['sketch-full']} strokeWidth="2" />
            <line x1="150" y1="250" x2="150" y2="110" stroke={c['sketch-full']} strokeWidth="2" />
            <line x1="150" y1="110" x2="420" y2="110" stroke={c['sketch-under']} strokeWidth="2" />
            <line x1="420" y1="110" x2="420" y2="250" stroke={c['sketch-over']} strokeWidth="2" />
            <line x1="285" y1="70" x2="285" y2="280" stroke={c['sketch-construction']} strokeDasharray="8 6" strokeWidth="1.5" />
            <circle cx="350" cy="180" r="30" fill="none" stroke={c['selected']} strokeWidth="3" />
            <g>
              <line x1="150" y1="275" x2="420" y2="275" stroke={c.dimension} strokeWidth="1" />
              <rect x="262" y="264" width="46" height="20" rx="3" fill={c['surface-raised']} />
              <text x="285" y="279" textAnchor="middle" fontSize="13" fill={c.dimension} fontFamily="IBM Plex Mono">60.00</text>
            </g>
            <g transform="translate(40 310)">
              <line x1="0" y1="0" x2="30" y2="0" stroke={c['axis-x']} strokeWidth="2" />
              <line x1="0" y1="0" x2="0" y2="-30" stroke={c['axis-y']} strokeWidth="2" />
              <line x1="0" y1="0" x2="-14" y2="12" stroke={c['axis-z']} strokeWidth="2" />
            </g>
          </svg>
        </div>
      </div>
      <StatusBar hint="Pick the end point of the line" sketchState="under" dof={3} units="mm" rebuild={{ state: 'idle', ms: 18 }} />
    </div>
  );
}
