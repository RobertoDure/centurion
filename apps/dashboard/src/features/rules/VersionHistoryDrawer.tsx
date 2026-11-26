import type { RuleDto } from '@centurion/contracts';

import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../components/ui/Table';
import { useRuleVersions } from '../../hooks/useRules';
import { formatDateTime } from '../../lib/format';

export interface VersionHistoryDrawerProps {
  rule: RuleDto | null;
  onClose: () => void;
}

export function VersionHistoryDrawer({ rule, onClose }: VersionHistoryDrawerProps) {
  const versions = useRuleVersions(rule?.id);

  return (
    <Drawer
      open={rule !== null}
      onClose={onClose}
      title="Version history"
      description={rule?.name}
    >
      {versions.isLoading && <p className="text-sm text-slate-500">Loading versions…</p>}
      {versions.isError && (
        <p role="alert" className="text-sm text-red-600">
          Could not load version history.
        </p>
      )}
      {versions.data !== undefined && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell>Primitive</TableHeaderCell>
              <TableHeaderCell>Enabled</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.data.items.map((version) => (
              <TableRow key={`${version.version}-${'snapshot' in version ? 'valid' : 'invalid'}`}>
                <TableCell className="tabular-nums">v{version.version}</TableCell>
                <TableCell>{formatDateTime(version.createdAt)}</TableCell>
                <TableCell>
                  {'snapshot' in version ? (
                    <Badge variant="info">{version.snapshot.question.type}</Badge>
                  ) : (
                    <Badge variant="danger" title={version.reason}>
                      invalid
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {'snapshot' in version ? (version.snapshot.enabled ? 'yes' : 'no') : '—'}
                </TableCell>
                <TableCell>{'snapshot' in version ? version.snapshot.name : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Drawer>
  );
}
