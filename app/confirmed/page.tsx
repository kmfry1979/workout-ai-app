export default function ConfirmedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow text-center">
        <h1 className="text-2xl font-bold mb-4">Email Verified ✅</h1>
        <p className="mb-6">Your account has been successfully confirmed.</p>

        <a
          href="/login"
          className="inline-block bg-black text-white px-4 py-2 rounded-lg"
        >
          Go to Login
        </a>
      </div>
    </main>
  )
}