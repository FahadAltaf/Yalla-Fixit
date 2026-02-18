'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BorderBeam } from '@/components/ui/border-beam'
import Logo from '@/components/ui/logo'
import AuthFullBackgroundShape from '@/assets/svg/auth-full-background-shape'

function ErrorContent() {
  const searchParams = useSearchParams()
  const errorType = searchParams.get('type') || 'auth_callback_error'

  const errorMessages: Record<string, string> = {
    auth_callback_error: 'There was a problem signing you in. Please try again.',
    profile_creation_error: "We couldn't create your profile. Please try again or contact support.",
    session_error: 'Your session has expired. Please sign in again.',
    oauth_error: 'OAuth authentication failed. Please try again.',
    default: 'An error occurred during authentication. Please try again.',
  }

  const errorMessage = errorMessages[errorType] || errorMessages.default

  return (
    <div className='h-dvh lg:grid lg:grid-cols-6'>
      {/* Dashboard Preview */}
      <div className='max-lg:hidden lg:col-span-3 xl:col-span-4'>
        <div className='bg-muted relative z-1 flex h-full items-center justify-center px-6'>
          <div className='outline-border relative shrink rounded-[20px] p-2.5 outline-2 -outline-offset-2'>
            <img
              src='https://cdn.shadcnstudio.com/ss-assets/blocks/marketing/auth/image-1.png'
              className='max-h-111 w-full rounded-lg object-contain dark:hidden'
              alt='Dashboards'
            />
            <img
              src='https://cdn.shadcnstudio.com/ss-assets/blocks/marketing/auth/image-1-dark.png'
              className='hidden max-h-111 w-full rounded-lg object-contain dark:inline-block'
              alt='Dashboards'
            />

            <BorderBeam duration={8} borderWidth={2} size={100} />
          </div>

          <div className='absolute -z-1'>
            <AuthFullBackgroundShape />
          </div>
        </div>
      </div>

      {/* Error Content */}
      <div className='flex h-full flex-col items-center justify-center py-10 sm:px-5 lg:col-span-3 xl:col-span-2'>
        <div className='w-full max-w-md px-6'>
          <div className='flex flex-col gap-6'>
            <Logo className='gap-3' />

            <div>
              <h2 className='mb-1.5 text-2xl font-semibold'>Authentication Error</h2>
              <p className='text-muted-foreground'>We encountered a problem while trying to authenticate you</p>
            </div>

            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>

            <p className='text-muted-foreground text-sm text-center'>
              If this problem persists, please contact support for assistance.
            </p>

            <div className='space-y-3'>
              <Button asChild className='w-full'>
                <Link href='/auth/login'>Try Again</Link>
              </Button>

              <Button asChild variant='outline' className='w-full'>
                <Link href='/'>Return to Home</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className='h-dvh lg:grid lg:grid-cols-6'>
          <div className='max-lg:hidden lg:col-span-3 xl:col-span-4'>
            <div className='bg-muted h-full' />
          </div>
          <div className='flex h-full flex-col items-center justify-center py-10 sm:px-5 lg:col-span-3 xl:col-span-2'>
            <div className='flex justify-center items-center'>
              <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-primary' />
            </div>
          </div>
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  )
}
