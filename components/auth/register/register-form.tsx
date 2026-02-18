'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { AuthServiceError, signUp } from '@/modules/auth/services/auth-service'

// Zod validation schema
const registerSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required').max(50, 'First name is too long'),
    lastName: z.string().min(1, 'Last name is required').max(50, 'Last name is too long'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
    agreeToTerms: z.boolean().refine(val => val === true, {
      message: 'You must agree to the privacy policy & terms',
    }),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

type RegisterFormData = z.infer<typeof registerSchema>

const RegisterForm = () => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false)
  const [userExists, setUserExists] = useState(false)

  const router = useRouter()

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      agreeToTerms: false,
    },
  })

  const onSubmit = async (data: RegisterFormData) => {
    setUserExists(false)

    try {
      // Prepare signup data in the format expected by AuthContext
      const signupData = {
        email: data.email,
        password: data.password,
        options: {
          data: {
            first_name: data.firstName,
            last_name: data.lastName,
          },
        },
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`,
      }

      const result = await signUp(signupData)
      if (result && typeof result === 'object' && 'type' in result && result.type === 'error') {
        throw new Error((result as AuthServiceError).message)
      }

      // Navigate to verification page
      router.push(`/auth/verify?email=${encodeURIComponent(data.email)}`)
    } catch (error: unknown) {
      // Handle specific error cases
      if (error instanceof Error && error.message?.includes('User already registered')) {
        setUserExists(true)
        toast.error('An account with this email already exists. Please login instead.')
      } else {
        toast.error(error instanceof Error ? error.message : 'An error occurred during registration')
      }
    }
  }

  return (
    <Form {...form}>
      <form className='space-y-4' onSubmit={form.handleSubmit(onSubmit)}>
        {/* First Name */}
        <FormField
          control={form.control}
          name='firstName'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='leading-5'>First Name*</FormLabel>
              <FormControl>
                <Input type='text' placeholder='Enter your first name' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Last Name */}
        <FormField
          control={form.control}
          name='lastName'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='leading-5'>Last Name*</FormLabel>
              <FormControl>
                <Input type='text' placeholder='Enter your last name' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Email */}
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='leading-5'>Email address*</FormLabel>
              <FormControl>
                <Input type='email' placeholder='Enter your email address' {...field} />
              </FormControl>
              <FormMessage />
              {userExists && <p className='text-destructive text-sm'>This email is already registered.</p>}
            </FormItem>
          )}
        />

        {/* Password */}
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='leading-5'>Password*</FormLabel>
              <FormControl>
                <div className='relative'>
                  <Input
                    type={isPasswordVisible ? 'text' : 'password'}
                    placeholder='••••••••••••••••'
                    className='pr-9'
                    {...field}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => setIsPasswordVisible(prevState => !prevState)}
                    className='text-muted-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 rounded-l-none hover:bg-transparent'
                  >
                    {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
                    <span className='sr-only'>{isPasswordVisible ? 'Hide password' : 'Show password'}</span>
                  </Button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Confirm Password */}
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='leading-5'>Confirm Password*</FormLabel>
              <FormControl>
                <div className='relative'>
                  <Input
                    type={isConfirmPasswordVisible ? 'text' : 'password'}
                    placeholder='••••••••••••••••'
                    className='pr-9'
                    {...field}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => setIsConfirmPasswordVisible(prevState => !prevState)}
                    className='text-muted-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 rounded-l-none hover:bg-transparent'
                  >
                    {isConfirmPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
                    <span className='sr-only'>{isConfirmPasswordVisible ? 'Hide password' : 'Show password'}</span>
                  </Button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Privacy policy */}
        <FormField
          control={form.control}
          name='agreeToTerms'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-center gap-3'>
                <FormControl>
                  <Checkbox
                    className='size-6'
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className='mt-0!'>I agree to privacy policy & terms</FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button className='w-full' type='submit' disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing up...' : 'Sign Up to Yalla Fixit'}
        </Button>
      </form>
    </Form>
  )
}

export default RegisterForm
