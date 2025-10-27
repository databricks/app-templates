'use client';

import { type ComponentProps, memo } from 'react';
import { DatabricksMessageCitationStreamdownIntegration } from '../databricks-message-citation';
import { Streamdown } from 'streamdown';

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  (props: ResponseProps) => {
    return (
      <Streamdown
        components={{
          a: DatabricksMessageCitationStreamdownIntegration,
        }}
        {...props}
      />
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
