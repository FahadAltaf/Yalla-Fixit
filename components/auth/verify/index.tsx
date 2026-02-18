'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { resendVerificationEmail } from '@/modules/auth/services/auth-service'
import { Button } from '@/components/ui/button'
import { BorderBeam } from '@/components/ui/border-beam'
import Logo from '@/components/ui/logo'
import AuthFullBackgroundShape from '@/assets/svg/auth-full-background-shape'

const VerifyEmail = () => {
  const [message, setMessage] = useState('Verifying your email...')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Check if the user has verified their email
    const checkVerification = async () => {
      try {
        // Get email from URL query params or localStorage if available
        const params = new URLSearchParams(window.location.search)
        const emailParam = params.get('email')

        if (emailParam) {
          setEmail(emailParam.replace(' ', '+'))
        }

        setMessage('Please check your email for the verification link.')
      } catch {
        setMessage('An error occurred during verification.')
      }
    }

    checkVerification()
  }, [])

  const handleResendVerification = async () => {
    if (!email) {
      toast.error('Email address not found. Please go back to signup.')
      return
    }

    try {
      setIsLoading(true)
      const result = await resendVerificationEmail(email)
      if (result && typeof result === 'object' && 'type' in result && result.type === 'error') {
        toast.error(result.message)
      } else {
        toast.success('Verification email sent. Please check your inbox.')
      }
    } finally {
      setIsLoading(false)
    }
  }
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

      {/* Verify Email Form */}
      <div className='flex h-full flex-col items-center justify-center py-10 sm:px-5 lg:col-span-3 xl:col-span-2'>
        <div className='w-full max-w-md px-6'>
          {/* <a href='#' className='text-muted-foreground group mb-12 flex items-center gap-2 sm:mb-16 lg:mb-24'>
            <ChevronLeftIcon className='transition-transform duration-200 group-hover:-translate-x-0.5' />
            <p>Back to the website</p>
          </a> */}

          <div className='flex flex-col gap-6'>
            <Logo className='gap-3' />

            <div>
              <h2 className='mb-1.5 text-2xl font-semibold'>Verify your email</h2>
              <p className='text-muted-foreground'>
                {email
                  ? `An activation link has been sent to your email address: ${email}. Please check your inbox and click on the link to complete the activation process.`
                  : message}
              </p>
            </div>

            <div className='space-y-4'>
              <Button className='w-full' asChild>
                <a href='/auth/login'>Skip for now</a>
              </Button>

              <p className='text-muted-foreground text-center'>
                Didn&apos;t get the mail?{' '}
                <button
                  onClick={handleResendVerification}
                  disabled={isLoading || !email}
                  className='text-card-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Sending...' : 'Resend'}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VerifyEmail
