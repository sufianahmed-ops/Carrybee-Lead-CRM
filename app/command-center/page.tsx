import { CommandCenter } from '@/components/command-center/CommandCenter';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '22px 18px' }}>
        <CommandCenter />
      </div>
    </div>
  );
}
