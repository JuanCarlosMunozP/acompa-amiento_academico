import { render } from '@testing-library/react-native';

import { ConfirmarCierreSesion } from '@/components/ConfirmarCierreSesion';

const mockModal: { props: { onRequestClose?: () => void } } = { props: {} };

jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: { children?: unknown; onRequestClose?: () => void }) => {
      mockModal.props = props;
      return React.createElement(React.Fragment, null, props.children);
    },
  };
});

test('el botón atrás del sistema cancela, salvo mientras se cierra la sesión', async () => {
  const onCancel = jest.fn();
  const vista = await render(
    <ConfirmarCierreSesion visible cerrando={false} onConfirm={jest.fn()} onCancel={onCancel} />,
  );
  mockModal.props.onRequestClose?.();
  expect(onCancel).toHaveBeenCalledTimes(1);

  await vista.rerender(
    <ConfirmarCierreSesion visible cerrando onConfirm={jest.fn()} onCancel={onCancel} />,
  );
  mockModal.props.onRequestClose?.();
  expect(onCancel).toHaveBeenCalledTimes(1);
});
