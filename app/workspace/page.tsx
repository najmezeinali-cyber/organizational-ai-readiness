import { redirect } from 'next/navigation';

// The public pilot starts with the required respondent form; there is no user dashboard.
export default function WorkspaceRedirect() {
  redirect('/start');
}
