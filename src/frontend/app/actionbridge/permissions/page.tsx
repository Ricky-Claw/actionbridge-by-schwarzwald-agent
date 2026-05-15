const rows = [
  ['site.knowledge.read', 'Read', 'No', 'Allowed public knowledge only'],
  ['lead.prepare_draft', 'Write draft', 'Yes', 'Prepare connector payload; deliver nothing'],
  ['lead.submit', 'Write', 'Yes', 'Approved connector delivery state only'],
  ['appointment.request.prepare_draft', 'Write draft', 'Yes', 'Prepare request; no calendar write'],
  ['payment.charge', 'Transactional', 'Blocked', 'Not in MVP'],
  ['crm.contact.delete', 'Destructive', 'Blocked', 'Not in MVP'],
];

export default function ActionBridgePermissionsPage() {
  return <main className="min-h-screen bg-[#08110d] px-6 py-12 text-stone-100"><section className="mx-auto max-w-5xl"><p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">Permission Matrix</p><h1 className="mt-4 text-4xl font-black">What the agent may do, what needs approval, and what is forbidden.</h1><div className="mt-8 overflow-hidden rounded-3xl border border-emerald-200/15"><table className="w-full border-collapse text-left text-sm"><thead className="bg-emerald-300/10 text-emerald-100"><tr><th className="p-4">Tool</th><th className="p-4">Risk</th><th className="p-4">Approval</th><th className="p-4">Control</th></tr></thead><tbody>{rows.map(([tool,risk,approval,control])=><tr key={tool} className="border-t border-white/10"><td className="p-4 font-mono text-xs">{tool}</td><td className="p-4">{risk}</td><td className="p-4">{approval}</td><td className="p-4 text-stone-300">{control}</td></tr>)}</tbody></table></div></section></main>;
}
