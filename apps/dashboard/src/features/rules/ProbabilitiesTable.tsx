import { formatPercent } from '../../lib/format';

export interface ProbabilitiesTableProps {
  probabilities: Record<string, number>;
  legend?: Record<string, string>;
}

export function ProbabilitiesTable({ probabilities, legend }: ProbabilitiesTableProps) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500">
          <th scope="col" className="py-1 pr-3 font-medium">
            Outcome
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Probability
          </th>
          <th scope="col" className="py-1 font-medium">
            &nbsp;
          </th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(probabilities).map(([key, value]) => (
          <tr key={key}>
            <th scope="row" className="py-1 pr-3 text-left font-normal text-slate-700">
              {legend?.[key] ?? key}
            </th>
            <td className="py-1 pr-3 tabular-nums text-slate-700">{formatPercent(value, 1)}</td>
            <td className="py-1">
              <div className="h-1.5 w-32 rounded bg-slate-100">
                <div
                  className="h-1.5 rounded bg-slate-900"
                  style={{ width: `${Math.round(value * 100)}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
