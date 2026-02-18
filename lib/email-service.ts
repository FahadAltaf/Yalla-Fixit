
import { Resend } from 'resend';

const resend = new Resend(process.env.NEXT_PUBLIC_RESEND_API_KEY!);

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export const emailService = {
  sendEmail: async ({ to, subject, html }: EmailOptions) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
          method: 'POST',
          body: JSON.stringify({ to, subject, html }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
      console.log("🚀 ~ error:", error)
      
    }
  },

  sendPaymentConfirmationEmail: async ({
    email,
    name,
    buildingName,
    unitNumber,
    unitType,
    unitSize,
    totalAmount,
    includeAMC,
    includeInsurance,
  }: {
    email: string;
    name: string;
    buildingName: string;
    unitNumber: string;
    unitType: string;
    unitSize: string;
    totalAmount: number;
    includeAMC: boolean;
    includeInsurance: boolean;
  }) => {
    const subject = 'Payment Confirmation - Property Management Service';
    const html = `
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">

    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">

        <tr>

            <td align="center" style="padding: 20px 0;">

                <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">

                    <!-- Body Content -->
                    <tr>

                        <td style="padding: 32px 24px; color: #202124;">
                            
                            <!-- Icon -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 24px;">
                                    
                                           <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #8B1E24 0%, #6B1619 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; position: relative;"><img data-emoji="✓" class="an1" alt="✓" aria-label="✓" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/2714/72.png" loading="lazy" style=" height: 49px; margin: 15px 0 0 15px;"></div>
                                    </td>
                                </tr>
                            </table>


                            <!-- Title -->
                            <h1 style="font-size: 28px; font-weight: 500; color: #202124; text-align: center; margin: 0 0 8px 0; letter-spacing: -0.5px;">Payment Confirmation</h1>
                            <p style="text-align: center; font-size: 14px; color: #5f6368; margin: 0 0 24px 0;">Thank you for choosing our property management service</p>


                            <!-- Welcome Message -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;">
                                <tr>
                                    <td style="background-color: #f8f9fa; border-left: 4px solid #8B1E24; padding: 16px; border-radius: 0 4px 4px 0; font-size: 14px; line-height: 1.6; color: #3c4043;">
                                        <p style="margin: 0;">Dear ${name || 'Valued Customer'},</p>
                                        <p style="margin: 10px 0 0 0;">Thank you for your payment. We're excited to manage your property and provide you with exceptional service.</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Payment Details -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px; border: 1px solid #e8e8e8; border-radius: 4px;">
                                <tr>
                                    <td style="padding: 16px;">
                                        <h2 style="font-size: 18px; font-weight: 500; color: #202124; margin: 0 0 16px 0;">Payment Details</h2>
                                        
                                        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 14px; color: #3c4043;">
                                            <tr>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4;">Property Type:</td>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4; text-align: right; font-weight: 500;">${unitType}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4;">Unit Size:</td>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4; text-align: right; font-weight: 500;">${unitSize}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4;">Building Name:</td>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4; text-align: right; font-weight: 500;">${buildingName || 'Not specified'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4;">Unit Number:</td>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4; text-align: right; font-weight: 500;">${unitNumber || 'Not specified'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4;">Services:</td>
                                                <td style="padding: 8px 0; border-bottom: 1px solid #f1f3f4; text-align: right; font-weight: 500;">
                                                    Base Management Service${includeAMC ? ', Annual Maintenance Contract' : ''}${includeInsurance ? ', Home Insurance' : ''}
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0; font-size: 16px; font-weight: 500;">Total Amount:</td>
                                                <td style="padding: 12px 0; font-size: 16px; text-align: right; font-weight: 600; color: #8B1E24;">${totalAmount.toLocaleString()} AED</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Next Steps -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;">
                                <tr>
                                    <td style="background-color: #f0fdf4; border: 1px solid #d1fae5; border-radius: 4px; padding: 16px; font-size: 14px; line-height: 1.6; color: #065f46;">
                                        <p style="margin: 0 0 8px 0; font-weight: 600;">Next Steps:</p>
                                        <ol style="margin: 0; padding-left: 20px;">
                                            <li style="margin: 6px 0;">Our team will contact you within 24 hours to schedule an initial property inspection.</li>
                                            <li style="margin: 6px 0;">You'll receive access to your client dashboard to track all property activities.</li>
                                            <li style="margin: 6px 0;">We'll begin marketing your property to potential tenants (if applicable).</li>
                                        </ol>
                                    </td>
                                </tr>
                            </table>

                            <!-- CTA Button -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;">
                                <tr>
                                    <td align="center">
                                        <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourwebsite.com'}/dashboard" style="display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #8B1E24 0%, #6B1619 100%); color: white; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: 600; border: none; box-shadow: 0 4px 12px rgba(139, 30, 36, 0.4);">View Dashboard</a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Contact Info -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px; background-color: #e8f4f8; border: 1px solid #b3dfe0; border-radius: 4px;">
                                <tr>
                                    <td style="padding: 16px; font-size: 13px; line-height: 1.6; color: #2c5282;">
                                        <p style="margin: 0 0 8px 0;"><strong>Need assistance?</strong></p>
                                        <p style="margin: 0;">If you have any questions or need support, please contact our customer service team at <a href="mailto:support@yourcompany.com" style="color: #1f73e6; text-decoration: none;">support@yourcompany.com</a> or call us at +971 4 123 4567.</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Quick Links -->
                            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td align="center" style="font-size: 12px; color: #5f6368;">
                                        <p style="margin: 0;">
                                            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourwebsite.com'}/faq" style="color: #1f73e6; text-decoration: none; margin: 0 12px;">FAQ</a>
                                            <span style="color: #dadce0;">|</span>
                                            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourwebsite.com'}/services" style="color: #1f73e6; text-decoration: none; margin: 0 12px;">Services</a>
                                            <span style="color: #dadce0;">|</span>
                                            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourwebsite.com'}/contact" style="color: #1f73e6; text-decoration: none; margin: 0 12px;">Contact Us</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr style="border-top: 1px solid #e8e8e8; background-color: #f8f9fa;">
                        <td style="padding: 16px 24px;">
                            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td style="font-size: 11px; color: #9aa0a6; text-align: center;">
                                        <p style="margin: 0 0 8px 0;">© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
                                        <p style="margin: 0;">
                                            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourwebsite.com'}/privacy" style="color: #1f73e6; text-decoration: none;">Privacy Policy</a>
                                            <span style="color: #dadce0;"> · </span>
                                            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://yourwebsite.com'}/terms" style="color: #1f73e6; text-decoration: none;">Terms of Service</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
    `;

    return emailService.sendEmail({ to: email, subject, html });
  },

  sendInviteEmail: async (email: string, inviteLink: string) => {
    const subject = 'You have been invited to join our platform';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Our Platform!</h2>
        <p>You have been invited to join our platform. To get started, please click the button below to set up your account:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${inviteLink}" 
             style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Accept Invitation
          </a>
        </div>
        <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
        <p style="word-break: break-all;">${inviteLink}</p>
        <p>This invitation link will expire in 24 hours.</p>
        <p>If you didn't request this invitation, please ignore this email.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">This is an automated message, please do not reply to this email.</p>
      </div>
    `;

    return emailService.sendEmail({ to: email, subject, html });
  }
}; 