import { Card, CardDescription, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import React from 'react'

const QuotationTemplates = () => {
  return (
    <Card className="w-full flex-1  relative top-px right-px gap-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex  gap-1 flex-col">
          <CardTitle className=" ">Quotation Templates</CardTitle>
          <CardDescription>
            Manage your quotation templates.
          </CardDescription>
        </div>
     
      </CardHeader>
      <CardContent className="space-y-6">
        
    </CardContent>
    </Card>
  )
}

export default QuotationTemplates
