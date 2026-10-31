import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/layout/AuthShell.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Input.jsx';
import { useAuthStore } from '../store/authStore.js';

/** Shared form behaviour: field-level errors from the API's `details`, plus a form-level message. */
function useAuthForm(action) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const submit = (values) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setFieldErrors({});
    try {
      await action(values);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      const fields = {};
      err.details?.forEach((d) => { fields[d.field] ||= d.message; });
      setFieldErrors(fields);
      if (!Object.keys(fields).length) setFormError(err.message);
      setBusy(false);
    }
  };
  return { busy, formError, fieldErrors, submit };
}

function FormError({ message }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, formError, fieldErrors, submit } = useAuthForm(login);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where your team left off."
      footer={<>New to CollabBoard? <Link to="/register" className="font-medium text-primary hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit({ email, password })} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} autoFocus />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} />
        <Button type="submit" loading={busy} className="w-full" size="lg">Sign in</Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, formError, fieldErrors, submit } = useAuthForm(register);

  return (
    <AuthShell
      title="Create your account"
      subtitle="Draw, plan and replay sessions together in real time."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit({ name, email, password })} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} autoFocus />
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} />
        <Input label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} hint="At least 8 characters, with a letter and a number." />
        <Button type="submit" loading={busy} className="w-full" size="lg">Create account</Button>
      </form>
    </AuthShell>
  );
}
