import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/layout/AuthShell.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Input.jsx';
import { authService } from '../services/auth.service.js';
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
  const notice = useLocation().state?.notice;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where your team left off."
      footer={<>New to CollabBoard? <Link to="/register" className="font-medium text-primary hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit({ email, password })} className="space-y-4" noValidate>
        {notice && <p role="status" className="rounded-lg bg-mint/15 px-3 py-2 text-sm text-ink">{notice}</p>}
        <FormError message={formError} />
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} autoFocus />
        <div>
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} />
          <Link to="/forgot-password" state={{ email }} className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline">Forgot password?</Link>
        </div>
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

const RESEND_SECONDS = 60;

/** Reset by emailed code: 1) enter the email, 2) enter the 6-digit code and a new password. */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState(useLocation().state?.email || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err) => {
    const fields = {};
    err.details?.forEach((d) => { fields[d.field] ||= d.message; });
    setFieldErrors(fields);
    if (!Object.keys(fields).length) setFormError(err.message);
  };

  const sendCode = async (e) => {
    e?.preventDefault();
    setBusy(true); setFormError(''); setFieldErrors({});
    try {
      await authService.forgotPassword(email.trim());
      setStep('code');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setBusy(true); setFormError(''); setFieldErrors({});
    try {
      await authService.resetPassword({ email: email.trim(), code: code.trim(), password });
      navigate('/login', { replace: true, state: { notice: 'Password changed. You were signed out everywhere; sign in with your new password.' } });
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle={step === 'email' ? 'Enter your email and we will send you a 6-digit code.' : `If ${email.trim()} has an account, a code is on its way. It works for 10 minutes.`}
      footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>}
    >
      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} autoFocus />
          <Button type="submit" loading={busy} className="w-full" size="lg">Send code</Button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fieldErrors.code} autoFocus className="[&_input]:font-mono [&_input]:tracking-[0.4em]" />
          <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} hint="At least 8 characters, with a letter and a number." />
          <Button type="submit" loading={busy} className="w-full" size="lg">Reset password</Button>
          <div className="flex items-center justify-between text-xs text-muted">
            <button type="button" onClick={() => { setStep('email'); setCode(''); setFormError(''); }} className="hover:text-ink hover:underline">Use a different email</button>
            <button type="button" disabled={cooldown > 0 || busy} onClick={sendCode} className="font-medium text-primary hover:underline disabled:text-muted disabled:no-underline">
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
