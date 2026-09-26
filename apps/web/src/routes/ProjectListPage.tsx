export function ProjectListPage() {
  return (
    <section>
      <h1>Projects</h1>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Last Scan</th>
            <th>Dependency Count</th>
            <th>Vulnerability Count</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={4}>No projects yet.</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
