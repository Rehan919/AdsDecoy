document.addEventListener('DOMContentLoaded', async () => {
  const state = await chrome.storage.local.get([
    'blockedTrackers',
    'extensionEnabled',
    'selectedPersona',
    'personaSessionHistory',
    'nextPersonaRunAt'
  ]);

  // Status
  document.getElementById('stat-status').textContent = state.extensionEnabled !== false ? 'Active' : 'Disabled';
  document.getElementById('stat-status').style.backgroundColor = state.extensionEnabled !== false ? 'var(--success)' : 'var(--danger)';

  // Persona
  document.getElementById('stat-persona').textContent = state.selectedPersona || 'Gardener';
  document.getElementById('stat-sessions').textContent = (state.personaSessionHistory || []).length;
  
  if (state.nextPersonaRunAt) {
    const diff = Math.max(0, state.nextPersonaRunAt - Date.now());
    const mins = Math.ceil(diff / 60000);
    document.getElementById('stat-next-run').textContent = `in ~${mins} min${mins !== 1 ? 's' : ''}`;
  }

  // Trackers
  const trackers = state.blockedTrackers || [];
  let totalBlocked = 0;
  const companies = {};

  trackers.forEach(t => {
    totalBlocked += (t.requestCount || 1);
    const company = t.company || t.domain;
    if (!companies[company]) {
      companies[company] = { name: company, category: t.primaryCategory || 'Unknown', count: 0 };
    }
    companies[company].count += (t.requestCount || 1);
  });

  document.getElementById('stat-total-blocked').textContent = totalBlocked.toLocaleString();
  document.getElementById('stat-unique-companies').textContent = Object.keys(companies).length.toLocaleString();

  const sortedCompanies = Object.values(companies).sort((a, b) => b.count - a.count).slice(0, 10);
  const tbody = document.getElementById('company-table-body');
  
  if (sortedCompanies.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #94a3b8;">No trackers blocked yet. Good job!</td></tr>';
  } else {
    tbody.innerHTML = '';
    sortedCompanies.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 500;">${c.name}</td>
        <td><span class="badge" style="background: #475569;">${c.category}</span></td>
        <td>${c.count.toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  }
});
